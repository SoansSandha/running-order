import { describe, expect, test } from 'vitest'
import { pairTracks } from './pairTracks.js'

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
})
