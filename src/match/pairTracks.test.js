import { describe, expect, test } from 'vitest'
import { pairTracks } from './pairTracks.js'

const sp = (id, name, artist, durationMs) => ({
  id, name, durationMs, videoType: null,
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
    // s2 is exact; s1 only drifts into range. Order must not decide it.
    const result = pairTracks(
      [sp('s1', 'Antidote', 'Karan Aujla', 192000), sp('s2', 'Antidote', 'Karan Aujla', 188000)],
      [yt('y1', 'Antidote', 'Karan Aujla', 188000)],
    )
    expect(result.pairs[0].spotify.id).toBe('s2')
    expect(result.pairs[0].tier).toBe('strong')
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
  })

  test('empty inputs produce empty output rather than throwing', () => {
    expect(pairTracks([], []).pairs).toEqual([])
    expect(pairTracks(null, null).counts.certain).toBe(0)
  })
})
