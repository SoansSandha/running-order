import { describe, expect, test } from 'vitest'
import { MAX_DRIFT_MS, STRONG_DRIFT_MS, scorePair } from './scorePair.js'

const track = (over = {}) => ({
  name: 'Antidote',
  artists: [{ id: 'a1', name: 'Karan Aujla' }],
  primaryArtist: { id: 'a1', name: 'Karan Aujla' },
  durationMs: 188000,
  videoType: null,
  ...over,
})

describe('scorePair', () => {
  test('exact title and artist within 2s is strong', () => {
    const result = scorePair(track(), track({ durationMs: 189000 }))
    expect(result.tier).toBe('strong')
    expect(result.durationDeltaMs).toBe(1000)
  })

  test('the delta is signed, youtube minus spotify', () => {
    expect(scorePair(track(), track({ durationMs: 186000 })).durationDeltaMs).toBe(-2000)
  })

  test('exactly 2s apart is still strong; 2001ms is not', () => {
    expect(scorePair(track(), track({ durationMs: 188000 + STRONG_DRIFT_MS })).tier).toBe('strong')
    expect(scorePair(track(), track({ durationMs: 188000 + STRONG_DRIFT_MS + 1 })).tier).toBe('likely')
  })

  test('exactly 5s apart is likely; 5001ms is not proposed at all', () => {
    expect(scorePair(track(), track({ durationMs: 188000 + MAX_DRIFT_MS })).tier).toBe('likely')
    expect(scorePair(track(), track({ durationMs: 188000 + MAX_DRIFT_MS + 1 }))).toBeNull()
  })

  test('trailing decoration is cut, so the pair is still strong', () => {
    // Measured: 'antidote official video' scores 0.483 against 'antidote' —
    // nowhere near the fuzzy floor. Without M5 this pair is lost entirely.
    const result = scorePair(track(), track({ name: 'Antidote (Official Video)' }))
    expect(result.tier).toBe('strong')
  })

  test('a real-world YouTube title with piped credits still matches', () => {
    // Taken verbatim from the live library.
    const spotify = track({ name: 'Into You' })
    const youtube = track({
      name: 'INTO YOU (OFFICIAL VIDEO) | TEGI PANNU | MANNI SANDHU | ROHIT NEGAH | LATEST PUNJABI SONGS 2025',
    })
    expect(scorePair(spotify, youtube).tier).toBe('strong')
  })

  test('a tail that names a VARIANT is not cut', () => {
    // M6: a duet version is a different recording, so this must not be
    // silently folded into the original the way decoration is.
    const result = scorePair(track({ name: 'Gal Dil Di' }), track({ name: 'Gal Dil Di (Duet Version 1)' }))
    expect(result).toBeNull()
  })

  test('a genuine spelling variant is likely', () => {
    // Measured: dice 0.947. This is what the fuzzy tier is actually for.
    const result = scorePair(track({ name: 'Saade Pind' }), track({ name: 'Saade Pindd' }))
    expect(result.tier).toBe('likely')
  })

  test('the same title by a different artist is NOT proposed', () => {
    // M1: a shared title alone is not evidence. This is the match that would
    // look right and be wrong.
    expect(scorePair(track(), track({
      artists: [{ id: 'b', name: 'Someone Else' }],
      primaryArtist: { id: 'b', name: 'Someone Else' },
    }))).toBeNull()
  })

  test('a featured artist on one side counts as an artist agreement', () => {
    const spotify = track({
      artists: [{ id: 'a1', name: 'Karan Aujla' }, { id: 'a2', name: 'Mxrci' }],
    })
    const youtube = track({
      artists: [{ id: 'a2', name: 'Mxrci' }],
      primaryArtist: { id: 'a2', name: 'Mxrci' },
    })
    expect(scorePair(spotify, youtube).tier).toBe('likely')
  })

  test('a live version is not proposed, because it runs long', () => {
    // The case the whole duration rule exists for.
    expect(scorePair(track(), track({ name: 'Antidote (Live)', durationMs: 215000 }))).toBeNull()
  })

  test('a different title by the same artist is not proposed', () => {
    expect(scorePair(track(), track({ name: 'Winning Speech' }))).toBeNull()
  })

  test('an empty title never matches another empty title', () => {
    expect(scorePair(track({ name: '' }), track({ name: '' }))).toBeNull()
  })

  test('a missing duration on either side is not proposed', () => {
    // Duration is the only hard discriminator; without it there is no evidence.
    expect(scorePair(track({ durationMs: 0 }), track())).toBeNull()
  })

  test('the reason says why it is not strong', () => {
    expect(scorePair(track(), track({ durationMs: 192000 })).reason).toMatch(/4s|duration/i)
  })
})
