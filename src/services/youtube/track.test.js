import { describe, expect, test } from 'vitest'
import { normalizeYouTubeSearchResults, normalizeYouTubeTracks } from './track.js'
import { ALBUM_TRACK, MUSIC_VIDEO, UNAVAILABLE, UNTYPED, USER_UPLOAD } from './fixtures.js'

describe('normalizeYouTubeTracks', () => {
  test('maps an album track onto the Track shape', () => {
    const [track] = normalizeYouTubeTracks([ALBUM_TRACK])
    expect(track.source).toBe('youtube')
    expect(track.id).toBe('VID0001')
    expect(track.itemId).toBe('SV0001')
    expect(track.name).toBe('Album Track')
    expect(track.artists).toEqual([{ id: 'UCartist1', name: 'An Artist' }])
    expect(track.album.name).toBe('An Album')
    expect(track.durationMs).toBe(211000)
    expect(track.originalIndex).toBe(0)
  })

  test('has no uri, so the writer can refuse to clone it', () => {
    const [track] = normalizeYouTubeTracks([ALBUM_TRACK])
    expect(track.uri).toBeNull()
  })

  test('leaves absent metadata empty rather than inventing it', () => {
    const [track] = normalizeYouTubeTracks([ALBUM_TRACK])
    // YouTube Music returns none of these. Faking them would make a sort
    // silently depend on a guess.
    expect(track.addedAt).toBeNull()
    expect(track.trackNumber).toBe(0)
    expect(track.discNumber).toBe(0)
    expect(track.releaseDateSortable).toBeNull()
    expect(track.popularity).toBe(0)
    expect(track.isrc).toBeNull()
  })

  test('handles a track with no album', () => {
    const [track] = normalizeYouTubeTracks([MUSIC_VIDEO])
    expect(track.album.name).toBe('')
    expect(track.album.id).toBeNull()
    expect(track.releaseDateSortable).toBeNull()
  })

  test('handles an artist with no id by falling back to the folded name', () => {
    const [track] = normalizeYouTubeTracks([USER_UPLOAD])
    expect(track.primaryArtist).toEqual({ id: null, name: 'Some Uploader' })
    expect(track.artistGroupKey).toBe('some uploader')
  })

  test('marks unavailable tracks', () => {
    const [track] = normalizeYouTubeTracks([UNAVAILABLE])
    expect(track.isUnavailable).toBe(true)
  })

  test('survives a missing videoType and a missing feedbackTokens', () => {
    // Measured: feedbackTokens is present on album tracks and absent on
    // videos and uploads, so the field set genuinely varies row to row.
    const tracks = normalizeYouTubeTracks([UNTYPED, MUSIC_VIDEO])
    expect(tracks).toHaveLength(2)
    expect(tracks.map((t) => t.itemId)).toEqual(['SV0005', 'SV0002'])
  })

  test('numbers tracks by fetch position', () => {
    const tracks = normalizeYouTubeTracks([ALBUM_TRACK, MUSIC_VIDEO, USER_UPLOAD])
    expect(tracks.map((t) => t.originalIndex)).toEqual([0, 1, 2])
  })

  test('numbers accepted tracks densely when rows are dropped', () => {
    // A loop-indexed implementation would yield [1, 3] here instead of [0, 1].
    const tracks = normalizeYouTubeTracks([
      { ...MUSIC_VIDEO, setVideoId: null },
      ALBUM_TRACK,
      { ...USER_UPLOAD, setVideoId: null },
      MUSIC_VIDEO,
    ])
    expect(tracks.map((t) => t.originalIndex)).toEqual([0, 1])
    expect(tracks.map((t) => t.itemId)).toEqual(['SV0001', 'SV0002'])
  })

  test('drops a row with no setVideoId, because it cannot be reordered', () => {
    // null is the beforeKey end-of-list sentinel, so it must never be a key.
    const tracks = normalizeYouTubeTracks([ALBUM_TRACK, { ...MUSIC_VIDEO, setVideoId: null }])
    expect(tracks).toHaveLength(1)
    expect(tracks[0].itemId).toBe('SV0001')
  })

  test('is a permutation of the rows it accepts', () => {
    const raw = [ALBUM_TRACK, MUSIC_VIDEO, USER_UPLOAD, UNAVAILABLE, UNTYPED]
    const tracks = normalizeYouTubeTracks(raw)
    expect(tracks).toHaveLength(raw.length)
    expect(tracks.map((t) => t.itemId)).toEqual(raw.map((r) => r.setVideoId))
  })

  test('carries videoType so the matcher can prefer an album track', () => {
    const [album] = normalizeYouTubeTracks([ALBUM_TRACK])
    const [video] = normalizeYouTubeTracks([MUSIC_VIDEO])
    expect(album.videoType).toBe('MUSIC_VIDEO_TYPE_ATV')
    expect(video.videoType).toBe('MUSIC_VIDEO_TYPE_OMV')
  })

  test('videoType is null when YouTube does not say', () => {
    // Measured: 13 of 383 real rows carry no videoType.
    expect(normalizeYouTubeTracks([UNTYPED])[0].videoType).toBeNull()
  })
})

describe('normalizeYouTubeSearchResults', () => {
  // Title, credit, length and type verbatim from a live search for
  // "AJA Kaléra" (filter videos) on 2026-10-08.
  const AJA_VIDEO = {
    title: 'AJA - Kaléra (Feat. Jaski)',
    artists: [{ name: 'Kaléra', id: null }],
    album: null,
    duration_seconds: 136,
    videoId: 'q7e348rz27I',
    isExplicit: false,
    videoType: 'MUSIC_VIDEO_TYPE_OMV',
    resultType: 'video',
  }

  test('maps a search result onto the Track shape, with no playlist item id', () => {
    const [track] = normalizeYouTubeSearchResults([AJA_VIDEO])
    expect(track).toMatchObject({
      id: 'q7e348rz27I',
      itemId: null,
      name: 'AJA - Kaléra (Feat. Jaski)',
      durationMs: 136000,
      videoType: 'MUSIC_VIDEO_TYPE_OMV',
      source: 'youtube',
      originalIndex: 0,
    })
    expect(track.primaryArtist).toEqual({ id: null, name: 'Kaléra' })
  })

  test('drops a result with no videoId, which can be neither played nor paired', () => {
    const tracks = normalizeYouTubeSearchResults([{ ...AJA_VIDEO, videoId: null }, AJA_VIDEO])
    expect(tracks.map((track) => [track.id, track.originalIndex])).toEqual([['q7e348rz27I', 0]])
  })
})
