import { describe, expect, test, vi } from 'vitest'
import { snapshotOf } from '../match/matchBook.js'
import { makeTrack, makeTracks, makeYouTubeTracks } from '../test/factory.js'
import { executeMirror, MirrorFailure, undoMirror } from './executeMirror.js'

const same = (spotifyKey, youtubeVideoId, found) => ({
  spotifyKey,
  youtubeVideoId,
  verdict: 'same',
  decidedAt: 1,
  ...(found ? { found } : {}),
})
const markSpotify = (spotifyKey) => ({ spotifyKey, youtubeVideoId: null, verdict: 'none', decidedAt: 1 })
const markYoutube = (youtubeVideoId) => ({ spotifyKey: null, youtubeVideoId, verdict: 'none', decidedAt: 1 })
const youtubeFind = (videoId) => snapshotOf(makeYouTubeTracks([{ videoId }])[0], 'youtube')
const spotifyFind = (id) => snapshotOf(makeTrack({ id, name: id }), 'spotify')
const ids = (tracks) => tracks.map((track) => track.id)

/**
 * Two in-memory playlists, with readers and writers that act on them as the
 * services do. Options make YouTube misbehave in the ways the spec names.
 */
function world({
  spotify,
  youtube,
  addToTop = false,
  reissueOnAdd = false,
  ignoreMoves = false,
  substitute = {},
  refuseYoutubeAddAt = 0,
  loseYoutubeAnswerAt = 0,
  ignoreRemovals = false,
  passingReadsAfterMoves = 0,
  // §9: after a bulk removal, the next N reads still show the removed items.
  lingeringRemovals = 0,
  // §9: after an add, the next N reads leave the added items out.
  lateAdds = 0,
  onYoutubeAdd,
}) {
  let next = 0
  // §9: for a while after a move, a read leaves the moved item out.
  let passing = 0
  let lastMoved = null
  let lingering = 0
  let lingered = []
  let late = 0
  let lateItems = new Set()
  const state = { spotify: [...spotify], youtube: [...youtube] }
  const log = []
  const renumber = (list) => list.map((track, index) => ({ ...track, originalIndex: index }))
  const youtubeWriter = {
    addTracks: vi.fn(async (playlistId, tracks) => {
      log.push('youtube.add')
      const call = youtubeWriter.addTracks.mock.calls.length
      if (call === refuseYoutubeAddAt) {
        // As the client's YouTubeRefusedError: nothing in this request was added.
        throw Object.assign(new Error('YouTube Music refused the addition.'), { nothingAdded: true })
      }
      const rows = tracks.map((track) => {
        const videoId = substitute[track.id] ?? track.id
        return { ...track, id: videoId, itemId: `new-${videoId}-${++next}`, source: 'youtube' }
      })
      if (reissueOnAdd) state.youtube = state.youtube.map((track) => ({ ...track, itemId: `re-${track.id}-${++next}` }))
      state.youtube = addToTop ? [...rows, ...state.youtube] : [...state.youtube, ...rows]
      late = lateAdds
      lateItems = new Set(rows.map((row) => row.itemId))
      onYoutubeAdd?.()
      if (call === loseYoutubeAnswerAt) throw new Error('YouTube Music did not answer.')
      return rows.map((row) => ({ videoId: row.id, setVideoId: row.itemId }))
    }),
    reorder: vi.fn(async (playlistId, op) => {
      log.push('youtube.move')
      const known = new Set(state.youtube.map((track) => track.itemId))
      if (!known.has(op.key) || (op.beforeKey !== null && !known.has(op.beforeKey))) {
        throw new Error(`No item ${op.key} or ${op.beforeKey} in the playlist`)
      }
      passing = passingReadsAfterMoves
      lastMoved = op.key
      if (ignoreMoves) return
      const moving = state.youtube.find((track) => track.itemId === op.key)
      const rest = state.youtube.filter((track) => track !== moving)
      const at = op.beforeKey === null ? rest.length : rest.findIndex((track) => track.itemId === op.beforeKey)
      state.youtube = [...rest.slice(0, at), moving, ...rest.slice(at)]
    }),
    removeTracks: vi.fn(async (playlistId, items) => {
      log.push('youtube.remove')
      if (ignoreRemovals) return
      const gone = new Set(items.map((item) => item.setVideoId))
      lingering = lingeringRemovals
      lingered = state.youtube.filter((track) => gone.has(track.itemId))
      state.youtube = state.youtube.filter((track) => !gone.has(track.itemId))
    }),
  }
  const spotifyWriter = {
    addTracks: vi.fn(async (playlistId, tracks) => {
      log.push('spotify.add')
      state.spotify = [...state.spotify, ...tracks]
    }),
    removeTracks: vi.fn(async (playlistId, tracks) => {
      log.push('spotify.remove')
      const gone = new Set(tracks.map((track) => track.uri))
      state.spotify = state.spotify.filter((track) => !gone.has(track.uri))
    }),
  }
  return {
    state,
    log,
    // The next `reads` reads of YouTube leave `itemId` out, as a move does (§9).
    passingReads: (reads, itemId) => {
      passing = reads
      lastMoved = itemId
    },
    spotifyWriter,
    youtubeWriter,
    readSpotify: async () => renumber(state.spotify),
    readYoutube: async () => {
      let rows = state.youtube
      if (passing > 0) {
        passing -= 1
        rows = rows.filter((track) => track.itemId !== lastMoved)
      }
      if (late > 0) {
        late -= 1
        rows = rows.filter((track) => !lateItems.has(track.itemId))
      }
      if (lingering > 0) {
        lingering -= 1
        rows = [...rows, ...lingered]
      }
      return renumber(rows)
    },
  }
}

/**
 * Spotify A B C D; YouTube C A X E. A and C pair; B's YouTube twin and E's
 * Spotify twin are confirmed finds; D and X are marked. Done, YouTube reads
 * A B C E X and Spotify A B C D E.
 */
function scenario(options = {}) {
  const spotify = makeTracks([{ id: 'sA' }, { id: 'sB' }, { id: 'sC' }, { id: 'sD' }])
  const youtube = makeYouTubeTracks([{ videoId: 'yC' }, { videoId: 'yA' }, { videoId: 'yX' }, { videoId: 'yE' }])
  const book = [
    same('sA', 'yA'),
    same('sC', 'yC'),
    same('sB', 'yB', youtubeFind('yB')),
    same('sE', 'yE', spotifyFind('sE')),
    markSpotify('sD'),
    markYoutube('yX'),
  ]
  return { ...world({ spotify, youtube, ...options }), book, previewed: { spotifyTracks: spotify, youtubeTracks: youtube } }
}

/** 51 Spotify songs whose YouTube twins are all finds: two YouTube chunks. */
function bigScenario(options = {}) {
  const spotify = makeTracks(Array.from({ length: 51 }, (_, i) => ({ id: `s${i}` })))
  const book = spotify.map((track, i) => same(track.id, `y${i}`, youtubeFind(`y${i}`)))
  return { ...world({ spotify, youtube: [], ...options }), book, previewed: { spotifyTracks: spotify, youtubeTracks: [] } }
}

async function run(s, overrides = {}) {
  const records = []
  const result = await executeMirror({
    spotifyPlaylistId: 'sp',
    youtubePlaylistId: 'yt',
    spotifyEditable: true,
    readSpotify: s.readSpotify,
    readYoutube: s.readYoutube,
    spotifyWriter: s.spotifyWriter,
    youtubeWriter: s.youtubeWriter,
    book: s.book,
    previewed: s.previewed,
    onRecord: (record) => {
      records.push(record)
      s.log.push('record')
    },
    sleep: async () => {},
    ...overrides,
  })
  return { result, records }
}

/** Run expecting a MirrorFailure; answers it with the records written. */
async function runFailing(s, overrides = {}) {
  const records = []
  try {
    await run(s, { onRecord: (record) => records.push(record), ...overrides })
  } catch (failure) {
    expect(failure).toBeInstanceOf(MirrorFailure)
    return { failure, records }
  }
  throw new Error('expected the run to fail')
}

describe('executeMirror', () => {
  test('adds the finds to both playlists and puts YouTube in Spotify’s order', async () => {
    const s = scenario()
    const { result } = await run(s)
    expect(ids(s.state.spotify)).toEqual(['sA', 'sB', 'sC', 'sD', 'sE'])
    expect(ids(s.state.youtube)).toEqual(['yA', 'yB', 'yC', 'yE', 'yX'])
    expect(result).toMatchObject({ kind: 'done', addedToYoutube: 1, addedToSpotify: 1, matches: true, unpaired: [] })
  })

  test('saves the undo record before the first write, and grows it as each request lands', async () => {
    const s = scenario()
    const { records } = await run(s)
    expect(s.log.slice(0, 3)).toEqual(['record', 'record', 'spotify.add'])
    expect(records[0]).toMatchObject({ orderBefore: ['yC', 'yA', 'yX', 'yE'], addedToYoutube: [], addedToSpotify: [] })
    expect(records[1].addedToSpotify).toEqual(['spotify:track:sE'])
    expect(records[3].addedToYoutube).toEqual([{ videoId: 'yB', setVideoId: 'new-yB-1' }])
    expect(records.at(-1).finished).toBe(true)
  })

  test('the record holds the chunk before its request is sent', async () => {
    const s = scenario()
    const { records } = await run(s)
    const at = s.log.indexOf('youtube.add')
    expect(s.log[at - 1]).toBe('record')
    const before = records[s.log.slice(0, at).filter((entry) => entry === 'record').length - 1]
    expect(before.addedToYoutube).toEqual([{ videoId: 'yB', setVideoId: null }])
  })

  test('an add that landed but lost its answer is still undone', async () => {
    const s = scenario({ loseYoutubeAnswerAt: 1 })
    const { records } = await runFailing(s)
    await undo(s, records.at(-1))
    expect(ids(s.state.youtube)).toEqual(['yC', 'yA', 'yX', 'yE'])
  })

  test('a refused add leaves nothing in the record', async () => {
    const s = scenario({ refuseYoutubeAddAt: 1 })
    const { records } = await runFailing(s)
    expect(records.at(-1).addedToYoutube).toEqual([])
  })

  test('writes nothing when a playlist changed since the preview', async () => {
    // Review Focus 3: E was added to YouTube by hand after the preview was built.
    const s = scenario()
    s.previewed = { ...s.previewed, youtubeTracks: s.previewed.youtubeTracks.slice(0, 3) }
    const { result, records } = await run(s)
    expect(result).toEqual({ kind: 'stale' })
    expect(s.log).toEqual([])
    expect(records).toEqual([])
  })

  test('writes nothing when the Spotify playlist was reordered since the preview', async () => {
    const s = scenario()
    const [a, b, ...rest] = s.state.spotify
    s.state.spotify = [b, a, ...rest]
    const { result } = await run(s)
    expect(result).toEqual({ kind: 'stale' })
    expect(s.log).toEqual([])
  })

  test('writes nothing when the YouTube playlist was reordered since the preview', async () => {
    const s = scenario()
    const [c, a, ...rest] = s.state.youtube
    s.state.youtube = [a, c, ...rest]
    const { result } = await run(s)
    expect(result).toEqual({ kind: 'stale' })
    expect(s.log).toEqual([])
  })

  test('refuses to add to a Spotify playlist the owner cannot edit, before any write', async () => {
    // Review Focus 4: reached without the panel's own check.
    const s = scenario()
    const { failure, records } = await runFailing(s, { spotifyEditable: false })
    expect(failure.message).toBe('This Spotify playlist isn’t yours to add to.')
    expect(s.log).toEqual([])
    expect(records).toEqual([])
  })

  test('no move names an item id from before the adds, even when YouTube reissues them all', async () => {
    // Mirror design §12: the corruption case, asserted directly.
    const s = scenario({ reissueOnAdd: true })
    await run(s)
    const keys = s.youtubeWriter.reorder.mock.calls.flatMap(([, op]) => [op.key, op.beforeKey]).filter(Boolean)
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.every((key) => /^(re|new)-/.test(key))).toBe(true)
    expect(ids(s.state.youtube)).toEqual(['yA', 'yB', 'yC', 'yE', 'yX'])
  })

  test('a playlist that adds new songs at the top still ends in Spotify’s order', async () => {
    // Review Focus 2.
    const s = scenario({ addToTop: true })
    const { result } = await run(s)
    expect(ids(s.state.youtube)).toEqual(['yA', 'yB', 'yC', 'yE', 'yX'])
    expect(result.matches).toBe(true)
  })

  test('with reordering off, adds and leaves the order alone', async () => {
    const s = scenario()
    const { result, records } = await run(s, { reorder: false })
    expect(s.youtubeWriter.reorder).not.toHaveBeenCalled()
    expect(ids(s.state.youtube)).toEqual(['yC', 'yA', 'yX', 'yE', 'yB'])
    expect(result).toMatchObject({ kind: 'done', matches: null })
    expect(records.at(-1).finished).toBe(true)
  })

  test('stops between requests, leaving the record unfinished', async () => {
    const controller = new AbortController()
    const s = scenario({ onYoutubeAdd: () => controller.abort() })
    const { result, records } = await run(s, { signal: controller.signal })
    expect(result).toMatchObject({ kind: 'stopped', addedToYoutube: 1 })
    expect(s.youtubeWriter.reorder).not.toHaveBeenCalled()
    expect(records.at(-1).finished).toBe(false)
  })

  test('a failed add reports how far it got, and the record holds only what landed', async () => {
    // Review Focus 5: the second YouTube request of two is refused.
    const s = bigScenario({ refuseYoutubeAddAt: 2 })
    const { failure, records } = await runFailing(s)
    expect(failure.message).toBe('Added 50 to YouTube and 0 to Spotify. Then: YouTube Music refused the addition.')
    expect(failure.report.addedToYoutube).toBe(50)
    expect(records.at(-1).addedToYoutube).toHaveLength(50)
    expect(records.at(-1).finished).toBe(false)
  })

  test('says so when YouTube shows a different order than the one written', async () => {
    const s = scenario({ ignoreMoves: true })
    const { result } = await run(s)
    expect(result.matches).toBe(false)
  })

  test('the check waits out a passing state', async () => {
    // §9: the first read after a move can leave the moved item out.
    const s = scenario({ passingReadsAfterMoves: 1 })
    const sleep = vi.fn(async () => {})
    const { result } = await run(s, { sleep })
    expect(result.matches).toBe(true)
    expect(sleep).toHaveBeenCalledWith(2000)
  })

  test('the run waits for its additions to show before planning the moves', async () => {
    const s = scenario({ lateAdds: 1 })
    const { result } = await run(s)
    expect(ids(s.state.youtube)).toEqual(['yA', 'yB', 'yC', 'yE', 'yX'])
    expect(result.matches).toBe(true)
  })

  test('Stop during the check still finishes the run', async () => {
    const controller = new AbortController()
    const s = scenario({ ignoreMoves: true })
    const read = s.readYoutube
    s.readYoutube = async () => {
      if (s.youtubeWriter.reorder.mock.calls.length > 0) controller.abort()
      return read()
    }
    const { result, records } = await run(s, { signal: controller.signal })
    expect(result).toMatchObject({ kind: 'done', matches: null })
    expect(records.at(-1).finished).toBe(true)
  })

  test('a failing check read doesn’t fail a run whose writes landed', async () => {
    const s = scenario()
    const read = s.readYoutube
    s.readYoutube = async () => {
      if (s.youtubeWriter.reorder.mock.calls.length > 0) throw new Error('YouTube Music did not answer.')
      return read()
    }
    const { result } = await run(s)
    expect(result).toMatchObject({ kind: 'done', matches: null })
  })

  test('names a song that was added but did not pair, and sends it to the bottom', async () => {
    // YouTube answered the add with another video than the one asked for.
    const s = scenario({ substitute: { yB: 'yB2' } })
    const { result } = await run(s)
    expect(ids(result.unpaired)).toEqual(['yB2'])
    expect(ids(s.state.youtube)).toEqual(['yA', 'yC', 'yE', 'yX', 'yB2'])
  })

  test('carries an unfinished record forward (D54)', async () => {
    const s = scenario()
    const prior = {
      version: 1,
      youtubePlaylistId: 'yt',
      spotifyPlaylistId: 'sp',
      orderBefore: ['old'],
      addedToYoutube: [{ videoId: 'yQ', setVideoId: 'q' }],
      addedToSpotify: [],
      finished: false,
      createdAt: 1,
    }
    const { records } = await run(s, { priorRecord: prior })
    expect(records[0]).toBe(prior)
    expect(records.at(-1).orderBefore).toEqual(['old'])
    expect(records.at(-1).addedToYoutube.map((entry) => entry.videoId)).toEqual(['yQ', 'yB'])
  })
})

async function undo(s, record, overrides = {}) {
  const records = []
  const result = await undoMirror({
    record,
    readYoutube: s.readYoutube,
    spotifyWriter: s.spotifyWriter,
    youtubeWriter: s.youtubeWriter,
    onRecord: (next) => records.push(next),
    sleep: async () => {},
    ...overrides,
  })
  return { result, records }
}

describe('undoMirror', () => {
  test('removes what the run added, from both playlists, and puts YouTube’s order back', async () => {
    const s = scenario()
    const { records: ran } = await run(s)
    const { result, records } = await undo(s, ran.at(-1))
    expect(ids(s.state.spotify)).toEqual(['sA', 'sB', 'sC', 'sD'])
    expect(ids(s.state.youtube)).toEqual(['yC', 'yA', 'yX', 'yE'])
    expect(result).toMatchObject({ kind: 'undone', removedFromYoutube: 1, removedFromSpotify: 1, restored: true })
    expect(records.at(-1)).toBeNull()
  })

  test('an undo started while a move is still settling does not drop that addition', async () => {
    const s = scenario()
    const { records: ran } = await run(s)
    s.passingReads(1, 'new-yB-1')
    const { result, records } = await undo(s, ran.at(-1))
    expect(s.youtubeWriter.removeTracks).toHaveBeenCalledTimes(1)
    expect(ids(s.state.youtube)).toEqual(['yC', 'yA', 'yX', 'yE'])
    expect(result).toMatchObject({ kind: 'undone', removedFromYoutube: 1 })
    expect(records.at(-1)).toBeNull()
  })

  test('leaves a copy of the same song the owner added by hand', async () => {
    const s = scenario()
    const { records: ran } = await run(s)
    const [yB] = makeYouTubeTracks([{ videoId: 'yB', setVideoId: 'by-hand' }])
    s.state.youtube = [yB, ...s.state.youtube]
    await undo(s, ran.at(-1))
    expect(s.state.youtube.map((track) => track.itemId)).toEqual(['set-yC', 'set-yA', 'set-yX', 'set-yE', 'by-hand'])
  })

  test('an addition whose recorded item is gone is never looked for by video id', async () => {
    // §9: ids are never reissued, so a gone id means a gone item (D17).
    const s = scenario()
    const { records: ran } = await run(s)
    const [byHand] = makeYouTubeTracks([{ videoId: 'yB', setVideoId: 'by-hand' }])
    s.state.youtube = [byHand, ...s.state.youtube.filter((track) => track.id !== 'yB')]
    await undo(s, ran.at(-1))
    expect(s.state.youtube.map((track) => track.itemId)).toContain('by-hand')
    const removed = s.youtubeWriter.removeTracks.mock.calls.flatMap(([, items]) => items)
    expect(removed.filter((item) => item.videoId === 'yB')).toEqual([])
  })

  test('an addition the owner already removed by hand costs no request', async () => {
    const s = scenario()
    const { records: ran } = await run(s)
    s.state.youtube = s.state.youtube.filter((track) => track.id !== 'yB')
    const { records } = await undo(s, ran.at(-1))
    expect(s.youtubeWriter.removeTracks).not.toHaveBeenCalled()
    expect(records[0].addedToYoutube).toEqual([])
  })

  test('a stopped undo keeps a record of exactly what is left to remove', async () => {
    const s = bigScenario()
    const { records: ran } = await run(s)
    const controller = new AbortController()
    const remove = s.youtubeWriter.removeTracks
    s.youtubeWriter.removeTracks = vi.fn(async (...args) => {
      await remove(...args)
      controller.abort()
    })
    const { result, records } = await undo(s, ran.at(-1), { signal: controller.signal })
    expect(result.kind).toBe('undoStopped')
    expect(records.at(-1).addedToYoutube).toHaveLength(1)
    expect(s.state.youtube).toHaveLength(1)
  })

  test('a failed Spotify removal keeps the record of what is still there', async () => {
    const s = scenario()
    const { records: ran } = await run(s)
    s.spotifyWriter.removeTracks = vi.fn(async () => {
      throw new Error('Spotify said no')
    })
    const records = []
    await expect(
      undoMirror({
        record: ran.at(-1),
        readYoutube: s.readYoutube,
        spotifyWriter: s.spotifyWriter,
        youtubeWriter: s.youtubeWriter,
        onRecord: (next) => records.push(next),
        sleep: async () => {},
      }),
    ).rejects.toThrow('Removed 1 from YouTube and 0 from Spotify. Then: Spotify said no')
    expect(records.at(-1)).toMatchObject({ addedToYoutube: [], addedToSpotify: ['spotify:track:sE'] })
  })

  test('after a run that failed partway, removes exactly what landed', async () => {
    // Review Focus 5.
    const s = bigScenario({ refuseYoutubeAddAt: 2 })
    const { records: ran } = await runFailing(s)
    expect(s.state.youtube).toHaveLength(50)
    await undo(s, ran.at(-1))
    expect(s.state.youtube).toEqual([])
  })

  test('a removal that removes nothing keeps the record and says so', async () => {
    const s = scenario({ ignoreRemovals: true })
    const { records: ran } = await run(s)
    const records = []
    const failure = await undo(s, ran.at(-1), { onRecord: (next) => records.push(next) }).catch((error) => error)
    expect(failure).toBeInstanceOf(MirrorFailure)
    expect(failure.message).toContain('YouTube Music kept 1 of the songs Undo removed. Undo again to retry.')
    // Nothing left the record, so the one undo started from is still held.
    expect((records.at(-1) ?? ran.at(-1)).addedToYoutube).toEqual(ran.at(-1).addedToYoutube)
  })

  test('a removal that shows late still completes the undo', async () => {
    const s = scenario({ lingeringRemovals: 2 })
    const { records: ran } = await run(s)
    const { result, records } = await undo(s, ran.at(-1))
    expect(ids(s.state.youtube)).toEqual(['yC', 'yA', 'yX', 'yE'])
    expect(result).toMatchObject({ kind: 'undone', removedFromYoutube: 1 })
    expect(records.at(-1)).toBeNull()
  })

  test('a removal whose check cannot read keeps the chunk in the record', async () => {
    const s = scenario()
    const { records: ran } = await run(s)
    let reads = 0
    const readYoutube = async () => {
      reads += 1
      // Reads 1 and 2 are the settled read; 3 is the check after the removal.
      if (reads === 3) throw new Error('YouTube Music did not answer.')
      return s.readYoutube()
    }
    const records = []
    const failure = await undo(s, ran.at(-1), { readYoutube, onRecord: (next) => records.push(next) }).catch((error) => error)
    expect(failure).toBeInstanceOf(MirrorFailure)
    expect(s.youtubeWriter.removeTracks).toHaveBeenCalledTimes(1)
    expect((records.at(-1) ?? ran.at(-1)).addedToYoutube).toEqual(ran.at(-1).addedToYoutube)
  })

  test('an add whose answers were all lost is undone by video id', async () => {
    // A run stops at the first lost answer, so its 50 placeholders make one chunk.
    const s = bigScenario({ loseYoutubeAnswerAt: 1 })
    const { records: ran } = await runFailing(s)
    expect(ran.at(-1).addedToYoutube).toHaveLength(50)
    expect(ran.at(-1).addedToYoutube.every((entry) => entry.setVideoId === null)).toBe(true)
    await undo(s, ran.at(-1))
    expect(s.state.youtube).toEqual([])
    expect(s.youtubeWriter.removeTracks).toHaveBeenCalledTimes(1)
    expect(s.youtubeWriter.removeTracks.mock.calls[0][1]).toHaveLength(50)
  })

  test('undo after a run with reordering off leaves the order alone', async () => {
    const s = scenario()
    const { records: ran } = await run(s, { reorder: false })
    const yE = s.state.youtube.find((track) => track.id === 'yE')
    s.state.youtube = [yE, ...s.state.youtube.filter((track) => track !== yE)]
    const { result } = await undo(s, ran.at(-1))
    expect(ids(s.state.spotify)).toEqual(['sA', 'sB', 'sC', 'sD'])
    expect(ids(s.state.youtube)).toEqual(['yE', 'yC', 'yA', 'yX'])
    expect(result).toMatchObject({ kind: 'undone', restored: false })
  })
})
