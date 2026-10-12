import { describe, expect, test } from 'vitest'
import { snapshotOf } from '../match/matchBook.js'
import { makeTrack, makeTracks, makeUnavailable, makeYouTubeTracks } from '../test/factory.js'
import { buildMoveOps } from './diff.js'
import { estimateMoves, mirrorOrder, planFill, sameItems, settleFromBook } from './mirror.js'

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
 * Spotify A B C D; YouTube C A X E. A and C pair; B's YouTube twin and E's
 * Spotify twin are confirmed finds; D and X are marked.
 */
function settledPair() {
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
  return { spotify, youtube, book }
}

describe('settleFromBook', () => {
  test('pairs only what the owner confirmed', () => {
    // An exact twin the matcher would call strong stays unmatched without a decision.
    const spotify = makeTracks([{ id: 'sA', name: 'Same Song' }])
    const youtube = makeYouTubeTracks([{ videoId: 'yA', title: 'Same Song' }])
    const result = settleFromBook(spotify, youtube, [])
    expect(result.pairs).toEqual([])
    expect(ids(result.unmatchedSpotify)).toEqual(['sA'])
  })

  test('a confirmed find is a certain pair, missing from the playlist that lacks it', () => {
    const { spotify, youtube, book } = settledPair()
    const result = settleFromBook(spotify, youtube, book)
    expect(result.pairs.every((pair) => pair.tier === 'certain')).toBe(true)
    expect(result.pairs.filter((pair) => pair.missingFrom === 'youtube').map((pair) => pair.youtube.id)).toEqual(['yB'])
    expect(result.pairs.filter((pair) => pair.missingFrom === 'spotify').map((pair) => pair.spotify.id)).toEqual(['sE'])
    expect(ids(result.markedSpotify)).toEqual(['sD'])
    expect(ids(result.markedYoutube)).toEqual(['yX'])
  })
})

describe('planFill', () => {
  test('nothing blocks a board the owner has settled', () => {
    const { spotify, youtube, book } = settledPair()
    expect(planFill(settleFromBook(spotify, youtube, book)).blocked).toBe(0)
  })

  test('counts every row still waiting: proposals, and unmatched songs on both sides', () => {
    const [a, b] = makeTracks([{ id: 'sA' }, { id: 'sB' }])
    const [y1, y2] = makeYouTubeTracks([{ videoId: 'y1' }, { videoId: 'y2' }])
    const result = {
      pairs: [
        { spotify: a, youtube: y1, tier: 'strong' },
        { spotify: b, youtube: y2, tier: 'likely' },
      ],
      unmatchedSpotify: makeTracks([{ id: 'sC' }]),
      unmatchedYoutube: makeYouTubeTracks([{ videoId: 'y3' }]),
    }
    expect(planFill(result).blocked).toBe(4)
  })

  test('a Spotify row with no track to key on does not block the run', () => {
    // Review Focus 1: a track Spotify no longer serves can be neither decided nor marked.
    const result = { pairs: [], unmatchedSpotify: [makeUnavailable(0)], unmatchedYoutube: [] }
    expect(planFill(result).blocked).toBe(0)
  })

  test('adds to YouTube in Spotify’s order, and to Spotify in YouTube’s order', () => {
    const spotify = makeTracks([{ id: 's1' }, { id: 's2' }])
    const youtube = makeYouTubeTracks([{ videoId: 'y1' }, { videoId: 'y2' }])
    const book = [
      same('s2', 'f2', youtubeFind('f2')),
      same('s1', 'f1', youtubeFind('f1')),
      same('g2', 'y2', spotifyFind('g2')),
      same('g1', 'y1', spotifyFind('g1')),
    ]
    const fill = planFill(settleFromBook(spotify, youtube, book))
    expect(ids(fill.addToYoutube)).toEqual(['f1', 'f2'])
    expect(ids(fill.addToSpotify)).toEqual(['g1', 'g2'])
  })

  test('a find the owner has not confirmed adds nothing', () => {
    const [song] = makeTracks([{ id: 's1' }])
    const [found] = makeYouTubeTracks([{ videoId: 'f1' }])
    const result = {
      pairs: [{ spotify: song, youtube: found, tier: 'strong', missingFrom: 'youtube' }],
      unmatchedSpotify: [],
      unmatchedYoutube: [],
    }
    expect(planFill(result).addToYoutube).toEqual([])
  })
})

describe('mirrorOrder', () => {
  test('YouTube follows Spotify, with songs in no pair at the bottom in their own order', () => {
    const { spotify, youtube, book } = settledPair()
    // As after the run's adds: B on YouTube, E on Spotify.
    const spotifyAfter = [...spotify, ...makeTracks([{ id: 'sE' }])]
    const youtubeAfter = [...youtube, ...makeYouTubeTracks([{ videoId: 'yB' }])]
    const { pairs } = settleFromBook(spotifyAfter, youtubeAfter, book)
    expect(ids(mirrorOrder(spotifyAfter, youtubeAfter, pairs))).toEqual(['yA', 'yB', 'yC', 'yE', 'yX'])
  })

  test('is always a permutation of the YouTube playlist', () => {
    const spotify = makeTracks(Array.from({ length: 12 }, (_, i) => ({ id: `s${i}` })))
    // y0 to y11, shuffled: 5 is coprime with 12.
    const youtube = makeYouTubeTracks(Array.from({ length: 12 }, (_, i) => ({ videoId: `y${(i * 5) % 12}` })))
    const book = [0, 3, 6, 9].map((i) => same(`s${i}`, `y${i}`))
    const order = mirrorOrder(spotify, youtube, settleFromBook(spotify, youtube, book).pairs)
    expect(order).toHaveLength(youtube.length)
    expect(new Set(order)).toEqual(new Set(youtube))
    expect(ids(order).slice(0, 4)).toEqual(['y0', 'y3', 'y6', 'y9'])
  })

  test('a song listed twice on Spotify puts its one YouTube copy at the first', () => {
    const spotify = makeTracks([{ id: 'sA' }, { id: 'sB' }, { id: 'sA' }])
    const youtube = makeYouTubeTracks([{ videoId: 'yB' }, { videoId: 'yA' }])
    const { pairs } = settleFromBook(spotify, youtube, [same('sA', 'yA'), same('sB', 'yB')])
    expect(ids(mirrorOrder(spotify, youtube, pairs))).toEqual(['yA', 'yB'])
  })

  test('a second YouTube copy of a song goes to the bottom', () => {
    const spotify = makeTracks([{ id: 'sA' }, { id: 'sB' }])
    const youtube = makeYouTubeTracks([
      { videoId: 'yA', setVideoId: 'first' },
      { videoId: 'yB' },
      { videoId: 'yA', setVideoId: 'second' },
    ])
    const { pairs } = settleFromBook(spotify, youtube, [same('sA', 'yA'), same('sB', 'yB')])
    expect(mirrorOrder(spotify, youtube, pairs).map((track) => track.itemId)).toEqual(['first', 'set-yB', 'second'])
  })

  test('a pair whose YouTube song is not in the playlist yet is left out', () => {
    const { spotify, youtube, book } = settledPair()
    // B's twin has not been added: the order holds only the playlist's own items.
    const { pairs } = settleFromBook(spotify, youtube, book)
    expect(ids(mirrorOrder(spotify, youtube, pairs))).toEqual(['yA', 'yC', 'yX', 'yE'])
  })
})

describe('estimateMoves', () => {
  test('none when YouTube already follows Spotify and nothing is to be added', () => {
    const spotify = makeTracks([{ id: 'sA' }, { id: 'sB' }])
    const youtube = makeYouTubeTracks([{ videoId: 'yA' }, { videoId: 'yB' }])
    const book = [same('sA', 'yA'), same('sB', 'yB')]
    expect(estimateMoves(spotify, youtube, settleFromBook(spotify, youtube, book))).toBe(0)
  })

  test('counts the moves with the songs to add placed at the end', () => {
    const { spotify, youtube, book } = settledPair()
    // YouTube C A X E, with B added at the end, ordered to A B C E X.
    expect(estimateMoves(spotify, youtube, settleFromBook(spotify, youtube, book))).toBe(
      buildMoveOps(['C', 'A', 'X', 'E', 'B'], ['A', 'B', 'C', 'E', 'X']).length,
    )
  })
})

describe('sameItems', () => {
  test('the same items in the same order, by the key given', () => {
    const tracks = makeTracks([{ id: 'a' }, { id: 'b' }])
    const byUri = (track) => track.uri
    expect(sameItems(tracks, [...tracks], byUri)).toBe(true)
    expect(sameItems(tracks, [tracks[1], tracks[0]], byUri)).toBe(false)
    expect(sameItems(tracks, tracks.slice(1), byUri)).toBe(false)
  })
})
