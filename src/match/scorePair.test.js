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
    // Asserts the whole sentence: /4s|duration/ could never fail on the
    // number, because "duration" is a substring of "durations".
    expect(scorePair(track(), track({ durationMs: 192000 })).reason).toBe(
      'The durations differ by 4s',
    )
  })

  test('a drift just past the strong boundary does not read as the boundary itself', () => {
    // Math.round would say "2s" here, while 2s IS strong — two rows in
    // different tiers showing the same delta with contradictory prose.
    expect(scorePair(track(), track({ durationMs: 188000 + STRONG_DRIFT_MS + 1 })).reason).toBe(
      'The durations differ by 3s',
    )
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

  // C-1: the veto used to exempt a pipe-led tail wholesale, so a single `|`
  // disabled every word in VARIANT_TAIL. Pipe segments are now checked
  // against PIPE_VARIANT_TAIL, the subset that cannot be part of a name.
  test.each([
    'Antidote | Karaoke',
    'Antidote | Instrumental',
    'Antidote | Bass Boosted',
    'Antidote | 8D Audio',
    'Antidote | Nightcore',
  ])('a variant named after a pipe is vetoed, not waved through as strong: %s', (name) => {
    expect(scorePair(track(), track({ name }))).toBeNull()
  })

  test('a variant in a LATER pipe segment is vetoed too, not just the first', () => {
    // The real upload convention the blanket pipe exemption missed:
    // SONG | ARTIST | BASS BOOSTED | TAG. Checking only the tail's first
    // segment would still wave this through.
    const youtube = track({
      name: 'ANTIDOTE | KARAN AUJLA | BASS BOOSTED | LATEST PUNJABI SONGS 2025',
    })
    expect(scorePair(track(), youtube)).toBeNull()
  })

  test.each([
    'Antidote | MixSingh',
    'Antidote | Mix Singh',
    'Antidote | Cover Art by X',
  ])('a name-collidable credit after a pipe is NOT vetoed: %s', (name) => {
    // mix, cover, edit, version, demo, remix and live are deliberately absent
    // from PIPE_VARIANT_TAIL — these are the credits the pipe exemption
    // existed to protect, and narrowing the list must not re-break them.
    expect(scorePair(track(), track({ name })).tier).toBe('strong')
  })

  test('a variant in a parenthesised tail is still vetoed by the full list', () => {
    // Non-pipe tails keep the wider VARIANT_TAIL: "duet" and "version" are
    // both in it, and neither is in the pipe subset.
    expect(scorePair(track(), track({ name: 'Antidote (Duet Version 1)' }))).toBeNull()
  })

  // I-1: the leading-segment cut had no check that what it kept was a title
  // rather than the artist's own name.
  test('a lead that is only the artist name is not treated as a title', () => {
    // Self-titled tracks and intros are common, so the kept fragment
    // fold-equals a real Spotify title, and the artist gate passes trivially
    // because YouTube does credit that artist.
    const spotify = track({ name: 'Karan Aujla' })
    const youtube = track({ name: 'Karan Aujla - Antidote (Official Video)' })
    expect(scorePair(spotify, youtube)).toBeNull()
  })

  test('a genuinely short title still matches through the cut', () => {
    // No minimum kept length: 'C4', 'Magic' and 'Snap' are real measured
    // titles, and a length floor would break every one of them.
    const artists = [{ id: 'h', name: 'Harkirat Sangha' }]
    const spotify = track({ name: 'C4', artists, primaryArtist: artists[0] })
    const youtube = track({ name: 'C4 - HARKIRAT SANGHA | STARBOY X', artists, primaryArtist: artists[0] })
    expect(scorePair(spotify, youtube).tier).toBe('strong')
  })

  // I-2: artist names must fold with sortKey, the way csv/match.js folds
  // them, not with matchText (the title folder). The two disagree on a
  // leading article, and the disagreement dropped the pair entirely.
  test('an artist differing only by a leading article still matches', () => {
    // matchText('The PropheC') = 'the prophec'; sortKey('The PropheC') =
    // 'prophec'. csv/match.js calls these the same artist, so this module
    // must too, or a later deliverable adds the track a second time.
    const spotify = track({
      name: 'Kadi Na Kharaab',
      artists: [{ id: 'p1', name: 'The PropheC' }],
      primaryArtist: { id: 'p1', name: 'The PropheC' },
    })
    const youtube = track({
      name: 'Kadi Na Kharaab',
      artists: [{ id: 'p2', name: 'PropheC' }],
      primaryArtist: { id: 'p2', name: 'PropheC' },
    })
    expect(scorePair(spotify, youtube).tier).toBe('strong')
  })
})
