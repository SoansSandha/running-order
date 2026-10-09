import { describe, expect, test } from 'vitest'
import { closestTitles, pairTracks, settlePairs } from './pairTracks.js'

// Every track carries an album, as catalogue audio does: scorePair reads an
// untyped YouTube row WITHOUT one as a video, which has a wider length window.
const sp = (id, name, artist, durationMs) => ({
  id, name, durationMs, videoType: null,
  album: { id: null, name: 'Making Memories' },
  artists: [{ id: artist, name: artist }],
  primaryArtist: { id: artist, name: artist },
})

const yt = (id, name, artist, durationMs, videoType = null) => ({
  ...sp(id, name, artist, durationMs), videoType,
})

describe('pairTracks', () => {
  test('pairs the obvious ones and reports the rest', () => {
    const result = pairTracks(
      [sp('s1', 'Antidote', 'Karan Aujla', 188000), sp('s2', 'Only Spotify', 'X', 100000)],
      [yt('y1', 'Antidote', 'Karan Aujla', 188000), yt('y2', 'Only YouTube', 'Z', 120000)],
    )
    expect(result.pairs).toHaveLength(1)
    expect(result.pairs[0].tier).toBe('strong')
    expect(result.unmatchedSpotify.map((t) => t.id)).toEqual(['s2'])
    expect(result.unmatchedYoutube.map((t) => t.id)).toEqual(['y2'])
  })

  test('one YouTube track cannot be claimed by two Spotify tracks', () => {
    // Greedy from a pool, exactly as the CSV matcher pairs duplicates.
    const result = pairTracks(
      [sp('s1', 'Antidote', 'Karan Aujla', 188000), sp('s2', 'Antidote', 'Karan Aujla', 188000)],
      [yt('y1', 'Antidote', 'Karan Aujla', 188000)],
    )
    expect(result.pairs).toHaveLength(1)
    expect(result.unmatchedSpotify).toHaveLength(1)
  })

  test('a strong match wins a contested track over a likely one', () => {
    // s2 is exact; s1 only drifts into range. Order must not decide it, so
    // this actually swaps the spotify array order (I-2) rather than just
    // asserting it in a comment.
    const forward = pairTracks(
      [sp('s1', 'Antidote', 'Karan Aujla', 192000), sp('s2', 'Antidote', 'Karan Aujla', 188000)],
      [yt('y1', 'Antidote', 'Karan Aujla', 188000)],
    )
    const reversed = pairTracks(
      [sp('s2', 'Antidote', 'Karan Aujla', 188000), sp('s1', 'Antidote', 'Karan Aujla', 192000)],
      [yt('y1', 'Antidote', 'Karan Aujla', 188000)],
    )
    expect(forward.pairs[0].spotify.id).toBe('s2')
    expect(forward.pairs[0].tier).toBe('strong')
    expect(reversed.pairs[0].spotify.id).toBe('s2')
    expect(reversed.pairs[0].tier).toBe('strong')
  })

  test('an album track beats a music video on an otherwise equal tie', () => {
    const result = pairTracks(
      [sp('s1', 'Antidote', 'Karan Aujla', 188000)],
      [
        yt('video', 'Antidote', 'Karan Aujla', 188000, 'MUSIC_VIDEO_TYPE_OMV'),
        yt('audio', 'Antidote', 'Karan Aujla', 188000, 'MUSIC_VIDEO_TYPE_ATV'),
      ],
    )
    expect(result.pairs[0].youtube.id).toBe('audio')
  })

  test('a confirmed pair is certain, whatever the tiers would have said', () => {
    const result = pairTracks(
      [sp('s1', 'Antidote', 'Karan Aujla', 188000)],
      [yt('y1', 'Completely Different', 'Nobody', 300000)],
      { verdictFor: () => 'same' },
    )
    expect(result.pairs[0].tier).toBe('certain')
  })

  test('a rejected pair is never proposed again', () => {
    // D16: without this, a pair you dismissed comes back every sync forever.
    const result = pairTracks(
      [sp('s1', 'Antidote', 'Karan Aujla', 188000)],
      [yt('y1', 'Antidote', 'Karan Aujla', 188000)],
      { verdictFor: () => 'different' },
    )
    expect(result.pairs).toHaveLength(0)
    expect(result.unmatchedSpotify).toHaveLength(1)
    expect(result.unmatchedYoutube).toHaveLength(1)
  })

  test('counts add up to the inputs', () => {
    const spotify = [sp('s1', 'A', 'X', 100000), sp('s2', 'B', 'Y', 100000)]
    const youtube = [yt('y1', 'A', 'X', 100000), yt('y2', 'C', 'Z', 100000)]
    const result = pairTracks(spotify, youtube)
    const { counts } = result
    const paired = counts.certain + counts.strong + counts.likely
    expect(paired + counts.unmatchedSpotify).toBe(spotify.length)
    expect(paired + counts.unmatchedYoutube).toBe(youtube.length)
    // I-2: the arithmetic above holds for ANY claim-set shape, even one that
    // pairs arbitrarily — pin exactly which tracks paired and which didn't.
    expect(result.pairs.map((pair) => [pair.spotify.id, pair.youtube.id])).toEqual([['s1', 'y1']])
    expect(result.unmatchedSpotify.map((t) => t.id)).toEqual(['s2'])
    expect(result.unmatchedYoutube.map((t) => t.id)).toEqual(['y2'])
  })

  test('empty inputs produce empty output rather than throwing', () => {
    expect(pairTracks([], []).pairs).toEqual([])
    expect(pairTracks(null, null).counts.certain).toBe(0)
  })

  test('sorting is a total order: reversing the youtube array does not change who pairs with whom (C-1)', () => {
    // s1 ties on BOTH y1 and y2 (1s drift each, both strong); s2 only reaches
    // y2 (4s drift, likely) — y1 is 6s from s2 and is not even a candidate.
    // Tier, drift and videoType all tie between s1-y1 and s1-y2, so without a
    // deterministic final tie-break the winner falls back to insertion order,
    // and reversing the youtube array silently drops s2's real match.
    const spotify = [sp('s1', 'Antidote', 'Karan Aujla', 188000), sp('s2', 'Antidote', 'Karan Aujla', 183000)]
    const y1 = yt('y1', 'Antidote', 'Karan Aujla', 189000)
    const y2 = yt('y2', 'Antidote', 'Karan Aujla', 187000)

    const forward = pairTracks(spotify, [y1, y2])
    const reversed = pairTracks(spotify, [y2, y1])

    const pairing = (result) => result.pairs.map((pair) => `${pair.spotify.id}-${pair.youtube.id}`).sort()

    expect(forward.pairs).toHaveLength(2)
    expect(pairing(reversed)).toEqual(pairing(forward))
    expect(pairing(forward)).toEqual(['s1-y1', 's2-y2'])
  })

  test('greedy claiming is confidence-first, not cardinality-optimal (I-1)', () => {
    // s1 ties strong with y1 (0s drift); s1-y2 and s2-y1 are only likely (3s
    // drift each), and s2-y2 exceeds the max drift so isn't a candidate at
    // all. The optimal ASSIGNMENT pairs s1-y2 and s2-y1 (2 matches), but
    // greedy claims the strongest candidate first (s1-y1) and starves s2, so
    // this pins the known 1-pair result rather than the 2-pair optimum.
    const result = pairTracks(
      [sp('s1', 'Antidote', 'Karan Aujla', 188000), sp('s2', 'Antidote', 'Karan Aujla', 191000)],
      [yt('y1', 'Antidote', 'Karan Aujla', 188000), yt('y2', 'Antidote', 'Karan Aujla', 185000)],
    )
    expect(result.pairs).toHaveLength(1)
    expect(result.pairs[0].spotify.id).toBe('s1')
    expect(result.pairs[0].youtube.id).toBe('y1')
    expect(result.unmatchedSpotify.map((t) => t.id)).toEqual(['s2'])
  })

  test('breaks a total tie by code-unit id order, not locale order', () => {
    // Ids are deliberately case-mixed: 'Z1' and 'a1' are chosen because
    // code-unit order and locale order pick OPPOSITE winners ('Z1' < 'a1' by
    // code unit, since 'Z' is 0x5A and 'a' is 0x61, but 'Z1'.localeCompare('a1')
    // says 'a1' sorts first). Renaming these to something tidy like 's1'/'s2'
    // would silently remove the test's teeth — it would pass whichever way
    // the comparator broke the tie.
    const spotifyZ = sp('Z1', 'Antidote', 'Karan Aujla', 188000)
    const spotifyA = sp('a1', 'Antidote', 'Karan Aujla', 188000)
    const youtube = [yt('y1', 'Antidote', 'Karan Aujla', 188000)]

    // Both candidates tie on tier (strong), drift (0ms) and videoType (both
    // score against the same youtube track), so only the id tie-break decides.
    const forward = pairTracks([spotifyZ, spotifyA], youtube)
    const reversed = pairTracks([spotifyA, spotifyZ], youtube)

    expect(forward.pairs[0].spotify.id).toBe('Z1')
    expect(forward.unmatchedSpotify.map((t) => t.id)).toEqual(['a1'])
    expect(reversed.pairs[0].spotify.id).toBe('Z1')
    expect(reversed.unmatchedSpotify.map((t) => t.id)).toEqual(['a1'])
  })

  test('settling uses the scored candidates it is given, without rescoring', () => {
    // scorePair rejects this pair outright (different artist, 112s apart), so
    // the only way it can come back paired is from the list handed in.
    const s = sp('s1', 'Antidote', 'Karan Aujla', 188000)
    const y = yt('y1', 'Something Else Entirely', 'Nobody', 300000)
    const scored = [{ spotify: s, youtube: y, tier: 'strong', durationDeltaMs: 0, reason: 'handed in' }]
    const result = settlePairs([s], [y], scored)
    expect(result.pairs.map((pair) => pair.reason)).toEqual(['handed in'])
  })

  test('a rejected pair re-pairs the Spotify song with its next-best match', () => {
    const s1 = sp('s1', 'Antidote', 'Karan Aujla', 188000)
    const y1 = yt('y1', 'Antidote', 'Karan Aujla', 188000)
    const y2 = yt('y2', 'Antidote', 'Karan Aujla', 191000)
    const verdictFor = (key, videoId) => (key === 's1' && videoId === 'y1' ? 'different' : null)
    const result = pairTracks([s1], [y1, y2], { verdictFor })
    expect(result.pairs.map((pair) => [pair.spotify.id, pair.youtube.id, pair.tier])).toEqual([['s1', 'y2', 'likely']])
    expect(result.unmatchedYoutube.map((track) => track.id)).toEqual(['y1'])
  })

  test('a rejected pair frees its YouTube track for the next Spotify song that wanted it', () => {
    const s1 = sp('s1', 'Antidote', 'Karan Aujla', 188000)
    const s2 = sp('s2', 'Antidote', 'Karan Aujla', 191000)
    const y1 = yt('y1', 'Antidote', 'Karan Aujla', 188000)
    const verdictFor = (key, videoId) => (key === 's1' && videoId === 'y1' ? 'different' : null)
    const result = pairTracks([s1, s2], [y1], { verdictFor })
    expect(result.pairs.map((pair) => [pair.spotify.id, pair.youtube.id, pair.tier])).toEqual([['s2', 'y1', 'likely']])
    expect(result.unmatchedSpotify.map((track) => track.id)).toEqual(['s1'])
  })

  test('a pair made by hand is certain even where the matcher proposes nothing', () => {
    // Verbatim from the live libraries: a label-channel upload, credited to
    // the label, which scorePair deliberately never pairs (root cause 8).
    const s = sp('s1', 'No Need', 'Karan Aujla', 189000)
    const y = yt(
      'y1',
      'No Need (Full Video) Karan Aujla | Deep Jandu | Rupan Bal | Latest Punjabi song 2019',
      'Rehaan Records',
      189000,
    )
    expect(pairTracks([s], [y]).pairs).toHaveLength(0)
    const result = pairTracks([s], [y], { verdictFor: () => 'same' })
    expect(result.pairs.map((pair) => pair.tier)).toEqual(['certain'])
  })

  test('a pair made by hand takes its YouTube track ahead of the matcher', () => {
    const s1 = sp('s1', 'Antidote', 'Karan Aujla', 188000)
    const s2 = sp('s2', 'Intro', 'Karan Aujla', 60000)
    const y1 = yt('y1', 'Antidote', 'Karan Aujla', 188000)
    const verdictFor = (key, videoId) => (key === 's2' && videoId === 'y1' ? 'same' : null)
    const result = pairTracks([s1, s2], [y1], { verdictFor })
    expect(result.pairs.map((pair) => [pair.spotify.id, pair.youtube.id, pair.tier])).toEqual([['s2', 'y1', 'certain']])
    expect(result.unmatchedSpotify.map((track) => track.id)).toEqual(['s1'])
  })

  test('a decision about a local file is found by its URI', () => {
    // Verbatim from the live libraries: a local file (no id) that the matcher
    // pairs as likely, 7s and one spelling apart.
    const local = {
      ...sp(null, 'Haye Mera Dil', 'Alfaaz; Yo Yo Honey Singh', 203000),
      uri: 'spotify:local:Alfaaz%3B+Yo+Yo+Honey+Singh:Boy+Next+Door:Haye+Mera+Dil:203',
      isLocal: true,
    }
    const y = yt('y1', 'Hai Mera Dil', 'Alfaaz', 210000)
    expect(pairTracks([local], [y]).pairs).toHaveLength(1)
    const verdictFor = (key, videoId) => (key === local.uri && videoId === 'y1' ? 'different' : null)
    expect(pairTracks([local], [y], { verdictFor }).pairs).toHaveLength(0)
  })

  test('the same song listed twice on Spotify claims one YouTube copy once', () => {
    const first = sp('s1', 'Antidote', 'Karan Aujla', 188000)
    const again = sp('s1', 'Antidote', 'Karan Aujla', 188000)
    const y = yt('y1', 'Antidote', 'Karan Aujla', 188000)
    const result = pairTracks([first, again], [y], { verdictFor: () => 'same' })
    expect(result.pairs).toHaveLength(1)
    expect(result.unmatchedSpotify).toHaveLength(1)
  })

  test('candidates for pairing by hand come most similar title first', () => {
    const target = sp('s1', 'Maar Sutya', 'Amrinder Gill', 239106)
    const options = [
      yt('y1', 'Antidote', 'Karan Aujla', 188000),
      yt('y2', 'Maar Sutiya', 'Amrinder Gill', 237000),
      yt('y3', 'Hai Mera Dil', 'Alfaaz', 210000),
    ]
    expect(closestTitles(target, options)[0].id).toBe('y2')
    expect(options.map((track) => track.id)).toEqual(['y1', 'y2', 'y3'])
  })

  test('candidates with equally dissimilar titles keep their playlist order', () => {
    const target = sp('s1', 'Abc', 'Someone', 1000)
    const options = [yt('y1', 'Qqq', 'Other', 1000), yt('y2', 'Zzz', 'Other', 1000)]
    expect(closestTitles(target, options).map((track) => track.id)).toEqual(['y1', 'y2'])
  })
})
