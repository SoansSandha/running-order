import { describe, expect, test } from 'vitest'
import { diceCoefficient, matchText } from '../csv/match.js'
import { FUZZY_FLOOR, MAX_DRIFT_MS, STRONG_DRIFT_MS, scorePair } from './scorePair.js'

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

  // I-1: Math.abs(durationDeltaMs) is the only thing that makes drift
  // symmetric. Each of these asserts the TIER, not just the delta, so a
  // mutant that drops Math.abs is caught (verified: see fix-round report).
  test('a large negative drift (a short clip under the full title) is not proposed', () => {
    // The case the finding names directly: a 30s clip against a 188s track.
    expect(scorePair(track(), track({ durationMs: 188000 - 30000 }))).toBeNull()
  })

  test('a negative drift one past the max is not proposed at all', () => {
    expect(scorePair(track(), track({ durationMs: 188000 - (MAX_DRIFT_MS + 1) }))).toBeNull()
  })

  test('a negative drift one past the strong threshold is likely, not strong', () => {
    expect(scorePair(track(), track({ durationMs: 188000 - (STRONG_DRIFT_MS + 1) })).tier).toBe('likely')
  })

  // I-4: the veto list now covers the commonest same-length variant tails,
  // and the inflecting members catch plurals.
  test.each([
    '(Karaoke)',
    '(Bass Boosted)',
    '(8D Audio)',
    '(Lofi Flip)',
    '(Extended)',
    '(Alternate Versions)',
  ])('a same-length %s upload is vetoed, not waved through as strong', (tail) => {
    expect(scorePair(track(), track({ name: `Antidote ${tail}` }))).toBeNull()
  })

  test('a producer credited after a pipe still reaches strong (MixSingh hard constraint)', () => {
    // Hard constraint: MixSingh is a producer's name, not a mix/remix tag —
    // the trailing \b is what protects it, and I-4's plural additions must
    // not weaken that.
    expect(scorePair(track(), track({ name: 'Antidote | MixSingh' })).tier).toBe('strong')
  })

  // I-2: the veto only checks the tail's first segment, so a later
  // pipe-chained credit cannot block a legitimate cut.
  test('a spaced producer credit after a pipe still reaches strong', () => {
    expect(scorePair(track(), track({ name: 'Antidote | Mix Singh' })).tier).toBe('strong')
  })

  test('a later pipe-chained credit does not veto the match', () => {
    expect(scorePair(track(), track({ name: 'Antidote | Cover Art by X' })).tier).toBe('strong')
  })

  test('a variant named in the first tail segment still vetoes, even with a credit chain after it', () => {
    const result = scorePair(
      track({ name: 'Gal Dil Di' }),
      track({ name: 'Gal Dil Di (Duet Version 1) | Some Channel' }),
    )
    expect(result).toBeNull()
  })

  // I-3: the dice fallback must consult the same veto as the leading-segment
  // path, or a long enough title clears the fuzzy floor with a variant tag
  // still attached.
  test('a variant tail does not sneak through the dice fallback on a long title', () => {
    // Measured: dice 0.912 between these two folded titles — well past
    // FUZZY_FLOOR — so only an explicit veto on the dice path stops it.
    const spotify = track({ name: 'Very Extremely Special Song' })
    const youtube = track({ name: 'Very Extremely Special Song (Live)' })
    expect(diceCoefficient(matchText(spotify.name), matchText(youtube.name))).toBeGreaterThanOrEqual(FUZZY_FLOOR)
    expect(scorePair(spotify, youtube)).toBeNull()
  })

  test('an exact live-to-live match still reaches strong (the dice-veto exception)', () => {
    const result = scorePair(track({ name: 'Antidote (Live)' }), track({ name: 'Antidote (Live)' }))
    expect(result.tier).toBe('strong')
  })
})
