import { describe, expect, test } from 'vitest'
import { makeTracks, makeYouTubeTracks } from '../test/factory.js'
import {
  buildRestoreOrder,
  clearMirrorRecord,
  clearSnapshot,
  createSnapshot,
  loadMirrorRecord,
  loadSnapshot,
  saveMirrorRecord,
  saveSnapshot,
  startMirrorRecord,
} from './undo.js'

function memoryStorage() {
  const store = new Map()
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
    store,
  }
}

const names = (tracks) => tracks.map((t) => t.name)

const playlist = () =>
  makeTracks([{ name: 'Alpha' }, { name: 'Bravo' }, { name: 'Charlie' }])

describe('createSnapshot', () => {
  const snapshot = createSnapshot(
    { id: 'p1', name: 'Road Trip', snapshotId: 'snap-1' },
    playlist(),
  )

  test('records what is needed to put the playlist back', () => {
    expect(snapshot).toMatchObject({ playlistId: 'p1', playlistName: 'Road Trip', snapshotId: 'snap-1' })
  })

  test('stores the track URIs in their original order', () => {
    expect(snapshot.uris).toHaveLength(3)
    expect(snapshot.uris[0]).toContain('spotify:track:')
  })

  test('timestamps the snapshot so an old one can be recognised', () => {
    expect(typeof snapshot.createdAt).toBe('number')
    expect(snapshot.createdAt).toBeLessThanOrEqual(Date.now())
  })

  test('records the track count, so a mismatch on restore is detectable', () => {
    expect(snapshot.trackCount).toBe(3)
  })
})

describe('buildRestoreOrder', () => {
  test('returns the playlist in the order the snapshot recorded', () => {
    const tracks = playlist()
    const snapshot = createSnapshot({ id: 'p1', name: 'x', snapshotId: 's' }, tracks)
    const shuffled = [tracks[2], tracks[0], tracks[1]]
    expect(names(buildRestoreOrder(shuffled, snapshot))).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })

  test('pairs duplicate URIs by occurrence rather than collapsing them', () => {
    const tracks = makeTracks([
      { id: 'dup11111111111111111111', name: 'First copy' },
      { name: 'Middle' },
      { id: 'dup11111111111111111111', name: 'Second copy' },
    ])
    const snapshot = createSnapshot({ id: 'p1', name: 'x', snapshotId: 's' }, tracks)
    const restored = buildRestoreOrder([tracks[2], tracks[1], tracks[0]], snapshot)
    expect(restored).toHaveLength(3)
    expect(restored[1].name).toBe('Middle')
  })

  test('appends tracks added since the snapshot to the bottom', () => {
    const original = playlist()
    const snapshot = createSnapshot({ id: 'p1', name: 'x', snapshotId: 's' }, original)
    const withNewTrack = makeTracks([
      { name: 'Alpha' },
      { name: 'Bravo' },
      { name: 'Charlie' },
      { name: 'Added Later' },
    ])
    expect(names(buildRestoreOrder(withNewTrack, snapshot)).at(-1)).toBe('Added Later')
  })

  test('skips snapshot entries whose track is no longer in the playlist', () => {
    const original = playlist()
    const snapshot = createSnapshot({ id: 'p1', name: 'x', snapshotId: 's' }, original)
    const shortened = [original[2], original[0]]
    expect(names(buildRestoreOrder(shortened, snapshot))).toEqual(['Alpha', 'Charlie'])
  })

  test('is a permutation of whatever the playlist currently holds', () => {
    const original = playlist()
    const snapshot = createSnapshot({ id: 'p1', name: 'x', snapshotId: 's' }, original)
    const current = [original[1], original[2], original[0]]
    const restored = buildRestoreOrder(current, snapshot)
    expect(restored).toHaveLength(current.length)
    expect([...restored].sort((a, b) => a.originalIndex - b.originalIndex))
      .toEqual([...current].sort((a, b) => a.originalIndex - b.originalIndex))
  })
})

describe('snapshot storage', () => {
  test('saves and loads a snapshot for a playlist', () => {
    const storage = memoryStorage()
    const snapshot = createSnapshot({ id: 'p1', name: 'x', snapshotId: 's' }, playlist())
    saveSnapshot(snapshot, storage)
    expect(loadSnapshot('p1', storage)).toEqual(snapshot)
  })

  test('returns null when nothing was ever saved', () => {
    expect(loadSnapshot('nope', memoryStorage())).toBe(null)
  })

  test('returns null rather than throwing on corrupt stored data', () => {
    const storage = memoryStorage()
    storage.setItem('playlist-sorter:undo:p1', '{ not json')
    expect(loadSnapshot('p1', storage)).toBe(null)
  })

  test('clears a snapshot once it is no longer wanted', () => {
    const storage = memoryStorage()
    saveSnapshot(createSnapshot({ id: 'p1', name: 'x', snapshotId: 's' }, playlist()), storage)
    clearSnapshot('p1', storage)
    expect(loadSnapshot('p1', storage)).toBe(null)
  })

  test('keeps snapshots for different playlists apart', () => {
    const storage = memoryStorage()
    saveSnapshot(createSnapshot({ id: 'p1', name: 'One', snapshotId: 's' }, playlist()), storage)
    saveSnapshot(createSnapshot({ id: 'p2', name: 'Two', snapshotId: 's' }, playlist()), storage)
    expect(loadSnapshot('p1', storage).playlistName).toBe('One')
    expect(loadSnapshot('p2', storage).playlistName).toBe('Two')
  })

  test('survives a storage that throws, as private browsing does', () => {
    const hostile = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    }
    const snapshot = createSnapshot({ id: 'p1', name: 'x', snapshotId: 's' }, playlist())
    expect(() => saveSnapshot(snapshot, hostile)).not.toThrow()
    expect(loadSnapshot('p1', hostile)).toBe(null)
  })
})

describe('buildRestoreOrder by another key', () => {
  test('restores a YouTube playlist by video id, with anything newer at the bottom', () => {
    const tracks = makeYouTubeTracks([{ videoId: 'c' }, { videoId: 'a' }, { videoId: 'new' }, { videoId: 'b' }])
    const restored = buildRestoreOrder(tracks, { uris: ['a', 'b', 'c'] }, (track) => track.id)
    expect(restored.map((track) => track.id)).toEqual(['a', 'b', 'c', 'new'])
  })
})

describe('the mirror undo record', () => {
  const youtubeTracks = makeYouTubeTracks([{ videoId: 'y1' }, { videoId: 'y2' }])
  const playlists = { youtubePlaylistId: 'yt', spotifyPlaylistId: 'sp', youtubeTracks }

  test('starts from YouTube’s order now, with nothing added', () => {
    expect(startMirrorRecord(null, playlists, 5)).toEqual({
      version: 1,
      youtubePlaylistId: 'yt',
      spotifyPlaylistId: 'sp',
      orderBefore: ['y1', 'y2'],
      addedToYoutube: [],
      addedToSpotify: [],
      reordered: false,
      finished: false,
      createdAt: 5,
    })
  })

  test('carries an unfinished record for the same playlists forward (D54)', () => {
    const prior = { ...startMirrorRecord(null, playlists, 1), orderBefore: ['old'], addedToSpotify: ['spotify:track:x'] }
    expect(startMirrorRecord(prior, playlists, 5)).toBe(prior)
  })

  test('starts afresh after a finished run', () => {
    const prior = { ...startMirrorRecord(null, playlists, 1), orderBefore: ['old'], finished: true }
    expect(startMirrorRecord(prior, playlists, 5).orderBefore).toEqual(['y1', 'y2'])
  })

  test('starts afresh for another Spotify playlist, so two are never mixed', () => {
    const prior = { ...startMirrorRecord(null, playlists, 1), orderBefore: ['old'] }
    expect(startMirrorRecord(prior, { ...playlists, spotifyPlaylistId: 'other' }, 5).orderBefore).toEqual(['y1', 'y2'])
  })

  test('round-trips through storage, filed under the YouTube playlist', () => {
    const storage = memoryStorage()
    const record = startMirrorRecord(null, playlists, 5)
    expect(saveMirrorRecord(record, storage)).toBe(true)
    expect(storage.store.has('playlist-sorter:mirror-undo:yt')).toBe(true)
    expect(loadMirrorRecord('yt', storage)).toEqual(record)
    clearMirrorRecord('yt', storage)
    expect(loadMirrorRecord('yt', storage)).toBeNull()
  })

  test('a blocked store saves nothing, reads as no record, and never throws', () => {
    const refuse = () => {
      throw new Error('blocked')
    }
    const blocked = { getItem: refuse, setItem: refuse, removeItem: refuse }
    expect(saveMirrorRecord(startMirrorRecord(null, playlists, 5), blocked)).toBe(false)
    expect(loadMirrorRecord('yt', blocked)).toBeNull()
    expect(() => clearMirrorRecord('yt', blocked)).not.toThrow()
  })

  test('a record of another version reads as no record', () => {
    const storage = memoryStorage()
    storage.setItem('playlist-sorter:mirror-undo:yt', JSON.stringify({ version: 99 }))
    expect(loadMirrorRecord('yt', storage)).toBeNull()
  })
})
