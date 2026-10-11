import { describe, expect, test, vi } from 'vitest'
import { normalizeYouTubeSearchResults } from '../services/youtube/track.js'
import { findOnSpotify, findOnYouTube, rankResults } from './findTwin.js'

// A Spotify track as the app normalizes it. Values below are verbatim from the
// live Punjabi Songs export.
const spotify = (id, name, artists, durationMs, isrc, album) => ({
  id,
  uri: id ? `spotify:track:${id}` : null,
  name,
  durationMs,
  isrc,
  isLocal: false,
  videoType: null,
  album: { id: null, name: album },
  artists: artists.map((artist) => ({ id: artist, name: artist })),
  primaryArtist: { id: artists[0], name: artists[0] },
})

// A ytmusicapi search result. Values below are verbatim from live searches on
// 2026-10-08.
const result = (videoId, title, artists, seconds, videoType, album = null) => ({
  videoId,
  title,
  artists: artists.map((name) => ({ name, id: null })),
  album: album && { name: album, id: null },
  duration_seconds: seconds,
  videoType,
})

/** A YouTube search answering from a table keyed `filter:query`, recording every call. */
const youtubeSearch = (table) =>
  vi.fn(async (query, filter) => normalizeYouTubeSearchResults(table[`${filter}:${query}`] ?? []))

const ATV = 'MUSIC_VIDEO_TYPE_ATV'
const OMV = 'MUSIC_VIDEO_TYPE_OMV'

describe('findOnYouTube', () => {
  const taal = spotify(
    '7fnd0BMPbWuMsn6lBrshZL',
    'Taal Se Taal - Remix',
    ['Alka Yagnik', 'Udit Narayan', 'Farooq Got Audio'],
    164848,
    'INT102400308',
    'Taal Se Taal (Remix)',
  )
  const taalHit = result(
    '5L3qPLhFrZE',
    'Taal Se Taal (Remix)',
    ['Alka Yagnik ', 'Udit Narayan'],
    165,
    ATV,
    'Taal Se Taal (Remix)',
  )

  test('an ISRC hit that scores strong ends the search', async () => {
    const search = youtubeSearch({ 'songs:INT102400308': [taalHit] })
    const { candidates } = await findOnYouTube(taal, search)
    expect(candidates.map((pair) => [pair.youtube.id, pair.tier])).toEqual([['5L3qPLhFrZE', 'strong']])
    expect(search.mock.calls).toEqual([['INT102400308', 'songs', 3]])
  })

  test('an ISRC that finds an unrelated song falls through to title and artist', async () => {
    const brown = spotify(
      '2w8OTd8nwVEcDA60S4Ws92',
      'BROWN BROWN RANG',
      ['Chani Nattan', 'Inderpal Moga', 'Karam Brar', 'G-Funk'],
      176818,
      'US38Y2507058',
      'NICE DAY IN THE PIND',
    )
    const search = youtubeSearch({
      'songs:US38Y2507058': [result('u1n1E3PMm0A', 'انا 5 استار على كوكبى', ['Hamo El Morshedy'], 279, OMV)],
      'songs:BROWN BROWN RANG Chani Nattan': [
        result(
          '26Ec977sp8A',
          'BROWN BROWN RANG',
          ['Chani Nattan', 'Inderpal Moga', 'Karam Brar', 'G-Funk'],
          177,
          ATV,
          'NICE DAY IN THE PIND',
        ),
      ],
    })
    const { candidates, nearMisses } = await findOnYouTube(brown, search)
    expect(candidates.map((pair) => [pair.youtube.id, pair.tier])).toEqual([['26Ec977sp8A', 'strong']])
    expect(nearMisses.map((track) => track.id)).toEqual(['u1n1E3PMm0A'])
    expect(search).toHaveBeenCalledTimes(2)
  })

  test('a song YouTube has only as a video is found among videos', async () => {
    const aja = spotify('54GK1bZMOAMXKysrnH4vTp', 'AJA', ['Kaléra', 'Jaski'], 134400, 'QZTBC2394855', 'AJA')
    const search = youtubeSearch({
      'songs:QZTBC2394855': [result('0iVlSNpq8i8', 'BIRDBRAIN (feat. OK Glass)', ['Jamie Paige'], 256, OMV)],
      'songs:AJA Kaléra': [result('3pW4PrhFiLc', 'Aaja', ['Nucleya'], 272, ATV, 'Bass Rani')],
      'videos:AJA Kaléra': [result('q7e348rz27I', 'AJA - Kaléra (Feat. Jaski)', ['Kaléra'], 136, OMV)],
    })
    const { candidates } = await findOnYouTube(aja, search)
    expect(candidates.map((pair) => [pair.youtube.id, pair.tier])).toEqual([['q7e348rz27I', 'strong']])
    expect(search.mock.calls.at(-1)).toEqual(['AJA Kaléra', 'videos', 3])
  })

  test('a mix-name variant is a near miss, offered once however often it is found', async () => {
    const parda = spotify(
      '4kCOXEXuJGmtL1Fze6WoEH',
      'Parda Hata Do - Farooq Got Audio Mix',
      ['Asha Bhosle', 'Mohammed Rafi', 'Farooq Got Audio'],
      182399,
      'INH102207809',
      'Bollywood Trap Mix',
    )
    const trapMix = result(
      '99mFO0XaoLQ',
      'Parda Hata Do - Trap Mix',
      ['Farooq Got Audio', 'Asha Bhosle', 'Mohammed Rafi'],
      183,
      ATV,
      'Bollywood Trap Mix',
    )
    const search = youtubeSearch({
      'songs:INH102207809': [trapMix],
      'songs:Parda Hata Do - Farooq Got Audio Mix Asha Bhosle': [trapMix],
    })
    const { candidates, nearMisses } = await findOnYouTube(parda, search)
    expect(candidates).toEqual([])
    expect(nearMisses.map((track) => track.id)).toEqual(['99mFO0XaoLQ'])
  })

  test('a result already in the YouTube playlist is skipped', async () => {
    const search = youtubeSearch({ 'songs:INT102400308': [taalHit] })
    const found = await findOnYouTube(taal, search, { skipIds: new Set(['5L3qPLhFrZE']) })
    expect(found).toEqual({ candidates: [], nearMisses: [] })
    expect(search).toHaveBeenCalledTimes(3)
  })

  test('a local file, which has no ISRC, starts with title and artist', async () => {
    const local = {
      ...spotify(null, 'Haye Mera Dil', ['Alfaaz; Yo Yo Honey Singh'], 203000, null, 'Boy Next Door'),
      uri: 'spotify:local:Alfaaz%3B+Yo+Yo+Honey+Singh:Boy+Next+Door:Haye+Mera+Dil:203',
      isLocal: true,
    }
    const search = youtubeSearch({})
    await findOnYouTube(local, search)
    expect(search.mock.calls[0]).toEqual(['Haye Mera Dil Alfaaz; Yo Yo Honey Singh', 'songs', 5])
  })
})

describe('findOnSpotify', () => {
  const sheeshaVideo = normalizeYouTubeSearchResults([
    result('sheeshaOMV', 'Sheesha | Karan Aujla | J Statik | Sagar Deol | New Punjabi Song 2022', ['Karan Aujla'], 176, OMV),
  ])[0]

  test('searches for the title read past its decoration, with the primary artist', async () => {
    const search = vi.fn(async () => [spotify('s1', 'Sheesha', ['Karan Aujla'], 161000, null, 'Sheesha')])
    const { candidates } = await findOnSpotify(sheeshaVideo, search)
    expect(search.mock.calls).toEqual([
      ['track:"sheesha" artist:"Karan Aujla"', 10],
      ['sheesha Karan Aujla', 10],
    ])
    // A video 15s longer than the audio is likely, never strong, so both steps run.
    expect(candidates.map((pair) => [pair.spotify.id, pair.tier])).toEqual([['s1', 'likely']])
  })

  test('a double quote in an artist name cannot break the field syntax', async () => {
    const quoted = { ...sheeshaVideo, primaryArtist: { id: null, name: 'DJ "Snake"' } }
    const search = vi.fn(async () => [])
    await findOnSpotify(quoted, search)
    expect(search.mock.calls[0][0]).toBe('track:"sheesha" artist:"DJ Snake"')
  })

  test('a video with no artist searches by title alone', async () => {
    const uncredited = { ...sheeshaVideo, artists: [], primaryArtist: null }
    const search = vi.fn(async () => [])
    await findOnSpotify(uncredited, search)
    expect(search.mock.calls).toEqual([
      ['track:"sheesha"', 10],
      ['sheesha', 10],
    ])
  })

  test('a result already in the Spotify playlist is skipped', async () => {
    const search = vi.fn(async () => [spotify('s1', 'Sheesha', ['Karan Aujla'], 161000, null, 'Sheesha')])
    expect(await findOnSpotify(sheeshaVideo, search, { skipIds: new Set(['s1']) })).toEqual({
      candidates: [],
      nearMisses: [],
    })
  })
})

describe('rankResults', () => {
  const brown = spotify(
    '2w8OTd8nwVEcDA60S4Ws92',
    'BROWN BROWN RANG',
    ['Chani Nattan', 'Inderpal Moga', 'Karam Brar', 'G-Funk'],
    176818,
    'US38Y2507058',
    'NICE DAY IN THE PIND',
  )
  const [arabic, exact] = normalizeYouTubeSearchResults([
    result('u1n1E3PMm0A', 'انا 5 استار على كوكبى', ['Hamo El Morshedy'], 279, OMV),
    result('26Ec977sp8A', 'BROWN BROWN RANG', ['Chani Nattan', 'Inderpal Moga', 'Karam Brar', 'G-Funk'], 177, ATV, 'NICE DAY IN THE PIND'),
  ])

  test('what the matcher accepts comes first, each result with its verdict', () => {
    expect(rankResults(brown, [arabic, exact], { side: 'youtube' }).map((row) => [row.track.id, row.accepted, row.verdict])).toEqual([
      ['26Ec977sp8A', true, 'strong: title and artist match exactly'],
      ['u1n1E3PMm0A', false, 'no match: lengths differ by 102s, different title, no artist in common'],
    ])
  })

  test('refused results keep their search order', () => {
    const later = { ...arabic, id: 'second00000' }
    expect(rankResults(brown, [arabic, later], { side: 'youtube' }).map((row) => row.track.id)).toEqual([
      'u1n1E3PMm0A',
      'second00000',
    ])
  })

  test('a result already in the other playlist is marked', () => {
    const rows = rankResults(brown, [arabic, exact], { side: 'youtube', inOtherPlaylist: (track) => track.id === '26Ec977sp8A' })
    expect(rows.map((row) => [row.track.id, row.already])).toEqual([
      ['26Ec977sp8A', true],
      ['u1n1E3PMm0A', false],
    ])
  })

  test('Spotify results are judged with the song on the YouTube side', () => {
    const sheeshaVideo = normalizeYouTubeSearchResults([
      result('sheeshaOMV', 'Sheesha | Karan Aujla | J Statik | Sagar Deol | New Punjabi Song 2022', ['Karan Aujla'], 176, OMV),
    ])[0]
    const slowed = spotify('s2', 'Sheesha (Slowed + Reverb)', ['Karan Aujla'], 200000, null, 'Sheesha')
    const sheesha = spotify('s1', 'Sheesha', ['Karan Aujla'], 161000, null, 'Sheesha')
    expect(rankResults(sheeshaVideo, [slowed, sheesha], { side: 'spotify' }).map((row) => [row.track.id, row.verdict])).toEqual([
      ['s1', 'likely: the durations differ by 15s'],
      ['s2', 'no match: lengths differ by 24s, different title'],
    ])
  })
})
