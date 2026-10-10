import { describe, expect, test } from 'vitest'
import { recordDecision, snapshotOf } from './matchBook.js'
import { settleFound } from './settleFound.js'

const sp = (id, name, durationMs) => ({
  id,
  uri: `spotify:track:${id}`,
  name,
  durationMs,
  artists: [{ id: 'a', name: 'Karan Aujla' }],
  primaryArtist: { id: 'a', name: 'Karan Aujla' },
})
const yt = (id, name, durationMs, videoType = 'MUSIC_VIDEO_TYPE_ATV') => ({
  id,
  uri: null,
  name,
  durationMs,
  videoType,
  artists: [{ id: null, name: 'Karan Aujla' }],
  primaryArtist: { id: null, name: 'Karan Aujla' },
})
const found = (spotify, youtube, tier, durationDeltaMs = 0) => ({
  spotify,
  youtube,
  tier,
  durationDeltaMs,
  reason: 'found',
})
/** What settlePairs returns when the two playlists pair nothing. */
const nothingPaired = (spotifyTracks, youtubeTracks) => ({
  pairs: [],
  unmatchedSpotify: spotifyTracks,
  unmatchedYoutube: youtubeTracks,
})
const summary = (result) => result.pairs.map((pair) => [pair.spotify.id, pair.youtube.id, pair.tier, pair.missingFrom])

describe('settleFound', () => {
  const song = sp('s1', 'Antidote', 188000)
  const y1 = yt('y1', 'Antidote', 188000)
  const y2 = yt('y2', 'Antidote', 191000)

  test('an unmatched Spotify song takes its best find, marked missing from YouTube', () => {
    const result = settleFound(nothingPaired([song], []), {
      spotifyTracks: [song],
      youtubeTracks: [],
      book: [],
      foundForSpotify: new Map([['s1', { candidates: [found(song, y1, 'strong'), found(song, y2, 'likely', 3000)] }]]),
    })
    expect(summary(result)).toEqual([['s1', 'y1', 'strong', 'youtube']])
    expect(result.unmatchedSpotify).toEqual([])
  })

  test('rejecting the best find moves the song to its next one', () => {
    const book = recordDecision([], { spotifyKey: 's1', youtubeVideoId: 'y1', verdict: 'different' }, 1)
    const result = settleFound(nothingPaired([song], []), {
      spotifyTracks: [song],
      youtubeTracks: [],
      book,
      foundForSpotify: new Map([['s1', { candidates: [found(song, y1, 'strong'), found(song, y2, 'likely', 3000)] }]]),
    })
    expect(summary(result)).toEqual([['s1', 'y2', 'likely', 'youtube']])
  })

  test('rejecting every find leaves the song unmatched', () => {
    const book = recordDecision([], { spotifyKey: 's1', youtubeVideoId: 'y1', verdict: 'different' }, 1)
    const result = settleFound(nothingPaired([song], []), {
      spotifyTracks: [song],
      youtubeTracks: [],
      book,
      foundForSpotify: new Map([['s1', { candidates: [found(song, y1, 'strong')] }]]),
    })
    expect(result.pairs).toEqual([])
    expect(result.unmatchedSpotify).toEqual([song])
  })

  test('an unmatched YouTube song takes its best Spotify find, marked missing from Spotify', () => {
    const video = yt('v1', 'Sheesha | Karan Aujla | New Punjabi Song 2022', 176000, 'MUSIC_VIDEO_TYPE_OMV')
    const twin = sp('t1', 'Sheesha', 161000)
    const result = settleFound(nothingPaired([], [video]), {
      spotifyTracks: [],
      youtubeTracks: [video],
      book: [],
      foundForYoutube: new Map([['v1', { candidates: [found(twin, video, 'likely', 15000)] }]]),
    })
    expect(summary(result)).toEqual([['t1', 'v1', 'likely', 'spotify']])
    expect(result.unmatchedYoutube).toEqual([])
  })

  test('a confirmed find is certain after a reload, rebuilt from its snapshot with no search', () => {
    const aja = sp('54GK1bZMOAMXKysrnH4vTp', 'AJA', 134400)
    const ajaVideo = yt('q7e348rz27I', 'AJA - Kaléra (Feat. Jaski)', 136000, 'MUSIC_VIDEO_TYPE_OMV')
    const book = recordDecision(
      [],
      { spotifyKey: aja.id, youtubeVideoId: ajaVideo.id, verdict: 'same', found: snapshotOf(ajaVideo, 'youtube') },
      1,
    )
    const result = settleFound(nothingPaired([aja], []), { spotifyTracks: [aja], youtubeTracks: [], book })
    expect(summary(result)).toEqual([[aja.id, 'q7e348rz27I', 'certain', 'youtube']])
    expect(result.pairs[0].youtube.name).toBe('AJA - Kaléra (Feat. Jaski)')
    expect(result.pairs[0].durationDeltaMs).toBe(1600)
  })

  test('a confirmed Spotify find is certain for its YouTube song', () => {
    const video = yt('v1', 'Sheesha | Karan Aujla | New Punjabi Song 2022', 176000, 'MUSIC_VIDEO_TYPE_OMV')
    const twin = sp('t1', 'Sheesha', 161000)
    const book = recordDecision(
      [],
      { spotifyKey: 't1', youtubeVideoId: 'v1', verdict: 'same', found: snapshotOf(twin, 'spotify') },
      1,
    )
    const result = settleFound(nothingPaired([], [video]), { spotifyTracks: [], youtubeTracks: [video], book })
    expect(summary(result)).toEqual([['t1', 'v1', 'certain', 'spotify']])
    expect(result.pairs[0].spotify.uri).toBe('spotify:track:t1')
  })

  test('a snapshot is ignored once its track is in the YouTube playlist', () => {
    const book = recordDecision(
      [],
      { spotifyKey: 's1', youtubeVideoId: 'y1', verdict: 'same', found: snapshotOf(y1, 'youtube') },
      1,
    )
    // y1 is in the playlist, so settlePairs owns the pair; here s1 is left
    // over only because something else claimed y1.
    const result = settleFound(nothingPaired([song], []), { spotifyTracks: [song], youtubeTracks: [y1], book })
    expect(result.pairs).toEqual([])
  })

  test('the same Spotify song listed twice claims one find once', () => {
    const again = sp('s1', 'Antidote', 188000)
    const result = settleFound(nothingPaired([song, again], []), {
      spotifyTracks: [song, again],
      youtubeTracks: [],
      book: [],
      foundForSpotify: new Map([['s1', { candidates: [found(song, y1, 'strong'), found(song, y2, 'strong', 1000)] }]]),
    })
    expect(result.pairs).toHaveLength(1)
    expect(result.unmatchedSpotify).toHaveLength(1)
  })

  test('the same YouTube video listed twice claims one Spotify find once', () => {
    const video = yt('v1', 'Sheesha | Karan Aujla | New Punjabi Song 2022', 176000, 'MUSIC_VIDEO_TYPE_OMV')
    const videoAgain = yt('v1', 'Sheesha | Karan Aujla | New Punjabi Song 2022', 176000, 'MUSIC_VIDEO_TYPE_OMV')
    const twin1 = sp('t1', 'Sheesha', 161000)
    const twin2 = sp('t2', 'Sheesha', 161000)
    const result = settleFound(nothingPaired([], [video, videoAgain]), {
      spotifyTracks: [],
      youtubeTracks: [video, videoAgain],
      book: [],
      foundForYoutube: new Map([
        ['v1', { candidates: [found(twin1, video, 'strong'), found(twin2, video, 'strong', 1000)] }],
      ]),
    })
    expect(result.pairs).toHaveLength(1)
    expect(result.unmatchedYoutube).toHaveLength(1)
  })

  test('two songs wanting one found track: the surer claim takes it', () => {
    const other = sp('s2', 'Antidote', 191000)
    // Two searches return the same video as two different objects.
    const result = settleFound(nothingPaired([other, song], []), {
      spotifyTracks: [other, song],
      youtubeTracks: [],
      book: [],
      foundForSpotify: new Map([
        ['s2', { candidates: [found(other, { ...y1 }, 'likely', 3000)] }],
        ['s1', { candidates: [found(song, { ...y1 }, 'strong')] }],
      ]),
    })
    expect(summary(result)).toEqual([['s1', 'y1', 'strong', 'youtube']])
    expect(result.unmatchedSpotify.map((track) => track.id)).toEqual(['s2'])
  })

  test('a pair confirmed before snapshots existed is certain when search finds it', () => {
    const book = recordDecision([], { spotifyKey: 's1', youtubeVideoId: 'y2', verdict: 'same' }, 1)
    const result = settleFound(nothingPaired([song], []), {
      spotifyTracks: [song],
      youtubeTracks: [],
      book,
      foundForSpotify: new Map([['s1', { candidates: [found(song, y1, 'strong'), found(song, y2, 'likely', 3000)] }]]),
    })
    expect(summary(result)).toEqual([['s1', 'y2', 'certain', 'youtube']])
  })

  test('the mirror: a pair confirmed before snapshots existed is certain when search finds it on Spotify', () => {
    const video = yt('v1', 'Sheesha | Karan Aujla | New Punjabi Song 2022', 176000, 'MUSIC_VIDEO_TYPE_OMV')
    const t1 = sp('t1', 'Sheesha', 161000)
    const t2 = sp('t2', 'Sheesha', 161000)
    const book = recordDecision([], { spotifyKey: 't2', youtubeVideoId: 'v1', verdict: 'same' }, 1)
    const result = settleFound(nothingPaired([], [video]), {
      spotifyTracks: [],
      youtubeTracks: [video],
      book,
      foundForYoutube: new Map([['v1', { candidates: [found(t1, video, 'strong'), found(t2, video, 'likely', 3000)] }]]),
    })
    expect(summary(result)).toEqual([['t2', 'v1', 'certain', 'spotify']])
  })

  test('pairs from the two playlists pass through untouched', () => {
    const playlistPair = found(song, y1, 'strong')
    const result = settleFound(
      { pairs: [playlistPair], unmatchedSpotify: [], unmatchedYoutube: [] },
      { spotifyTracks: [song], youtubeTracks: [y1], book: [] },
    )
    expect(result.pairs).toEqual([playlistPair])
    expect(result.pairs[0]).toBe(playlistPair)
  })
})
