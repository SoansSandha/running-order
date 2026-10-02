import { describe, expect, test } from 'vitest'
import { diceCoefficient, matchText } from '../csv/match.js'
import {
  FUZZY_FLOOR,
  LOCAL_MAX_DRIFT_MS,
  MAX_DRIFT_MS,
  PIPE_VARIANT_TAIL,
  SPELLING_DRIFT_MS,
  STRONG_DRIFT_MS,
  VARIANT_TAIL,
  VIDEO_MAX_DRIFT_MS,
  scorePair,
} from './scorePair.js'

const track = (over = {}) => ({
  name: 'Antidote',
  artists: [{ id: 'a1', name: 'Karan Aujla' }],
  primaryArtist: { id: 'a1', name: 'Karan Aujla' },
  durationMs: 188000,
  videoType: null,
  // An album, as any catalogue track has. An untyped YouTube row WITHOUT one
  // is read as a video, so this keeps the default on album-audio timing.
  album: { id: 'al1', name: 'Making Memories' },
  ...over,
})

/** A YouTube official music video, which carries no album. */
const video = (over = {}) => track({ videoType: 'MUSIC_VIDEO_TYPE_OMV', album: { id: null, name: '' }, ...over })

/**
 * Split `\b(a|b|c)\b` into its top-level alternatives.
 *
 * Both veto patterns are written in exactly that shape, so the alternatives
 * can be compared directly instead of guessing at sample strings for each
 * one. `assertSplittable` below is what keeps that assumption honest.
 */
const alternatives = (pattern) => {
  const body = pattern.source.replace(/^\\b\(/, '').replace(/\)\\b$/, '')
  expect(body, 'pattern is not in the \\b(...)\\b shape this split assumes').not.toBe(pattern.source)
  return body.split('|')
}

/**
 * A `|` inside a group or a character class would make the naive split above
 * wrong, and it would show up as an alternative with unbalanced brackets.
 */
const isBalanced = (token) => {
  let parens = 0
  let classes = 0
  for (let i = 0; i < token.length; i++) {
    const char = token[i]
    if (char === '\\') {
      i += 1
      continue
    }
    if (char === '(') parens += 1
    else if (char === ')') parens -= 1
    else if (char === '[') classes += 1
    else if (char === ']') classes -= 1
    if (parens < 0 || classes < 0) return false
  }
  return parens === 0 && classes === 0
}

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
    // Owner decision: with the exact title and the length agreeing, any
    // artist in common is enough for strong, whoever is credited first.
    const spotify = track({
      artists: [{ id: 'a1', name: 'Karan Aujla' }, { id: 'a2', name: 'Mxrci' }],
    })
    const youtube = track({
      artists: [{ id: 'a2', name: 'Mxrci' }],
      primaryArtist: { id: 'a2', name: 'Mxrci' },
    })
    expect(scorePair(spotify, youtube).tier).toBe('strong')
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

  // Audit root cause 2: real spellings the vocabulary missed. Each of these is
  // a re-processed or re-recorded upload that keeps the original's length, so
  // duration cannot catch it and it reached strong.
  test.each([
    '(16D Audio)',
    '(9D Audio)',
    '(3D Audio)',
    '(16D)',
    '(Bass Boost)',
    '(Lo Fi)',
    '(Remixed by DJ Chetas)',
    '(Rmx)',
    '(Reprised)',
    '(Reverbed)',
    '(Inst.)',
    '(Minus One)',
    '(Without Vocals)',
  ])('a same-length %s upload is vetoed, not waved through as strong', (tail) => {
    expect(scorePair(track(), track({ name: `Antidote ${tail}` }))).toBeNull()
  })

  // A bare mood or voice tag names a different recording too: a sad or a
  // female version is sung again, not decorated. Since both titles are
  // reduced the same way (root cause 7), a missing word here lets the tag
  // through from EITHER side, so both directions are pinned.
  test.each(['(Sad)', '(Female)', '(Male)'])('a bare %s tag is a different recording, on either side', (tag) => {
    expect(scorePair(track(), track({ name: `Antidote ${tag}` }))).toBeNull()
    expect(scorePair(track({ name: `Antidote ${tag}` }), track())).toBeNull()
  })

  test.each([
    'Antidote | 16D Audio',
    'Antidote | Bass Boost',
    'Antidote | Lo Fi',
    'Antidote | Reverbed',
  ])('a name-safe spelling is vetoed after a pipe too: %s', (name) => {
    expect(scorePair(track(), track({ name }))).toBeNull()
  })

  // Audit root cause 3: a sequel is a different song. A Part 2 only reaches
  // strong when it runs within 2s of the original, but when it does, nothing
  // else in the title says so.
  test.each([
    'Antidote (Part 2)',
    'Antidote (Pt. 2)',
    'Antidote (Part II)',
    'Antidote - Part 2',
    'Antidote | Part 2',
  ])('a sequel marker is a different song, not decoration: %s', (name) => {
    expect(scorePair(track(), track({ name }))).toBeNull()
  })

  test('a film name that carries a part number is still decoration', () => {
    // Why the sequel marker must OPEN its segment rather than appear anywhere
    // in it: film sequels are named this way, and this is the original song
    // credited to its film.
    expect(scorePair(track(), track({ name: 'Antidote (From "Carry On Jatta Part 2")' })).tier).toBe('strong')
  })

  test.each([
    'Antidote (2D Animated Video)',
    'Antidote (3D Video)',
    'Antidote (4K Video)',
  ])('a numbered VIDEO tag is decoration, not spatial audio: %s', (name) => {
    // The spatial-audio spelling is tied to the word "audio" for this reason:
    // a bare numeral-D would also veto an animated or 3D music video, which is
    // the same recording with different pictures.
    expect(scorePair(track(), track({ name })).tier).toBe('strong')
  })

  test('a producer credited after a pipe as one word still reaches strong (MixSingh)', () => {
    // MixSingh is a producer's name, written this way in the live library.
    // The trailing \b is what protects it now that "mix" vetoes after a pipe.
    expect(scorePair(track(), track({ name: 'Antidote | MixSingh' })).tier).toBe('strong')
  })

  // Owner decision: Spotify is the source of truth, so a pipe segment that
  // names a variant vetoes the way a bracket does. These words were once left
  // off the pipe list to protect credits like "| Mix Singh"; the owner chose
  // the stricter rule, and the live library holds no spaced "Mix Singh".
  test.each([
    'Antidote | Live',
    'Antidote | Remix',
    'Antidote | Rmx',
    'Antidote | Trap Mix',
    'Antidote | Cover',
    'Antidote | Edit',
    'Antidote | Punjabi Version',
    'Antidote | Demo',
    'Antidote | Reprise',
    'Antidote | Without Vocals',
  ])('a variant after a pipe is vetoed when Spotify names none: %s', (name) => {
    expect(scorePair(track(), track({ name }))).toBeNull()
  })

  test.each([
    ['Antidote - Live', 'Antidote | Live | Karan Aujla'],
    ['Antidote (Remix)', 'Antidote | Remix'],
  ])('a variant after a pipe still matches when Spotify names it too: %s / %s', (spotifyName, youtubeName) => {
    expect(scorePair(track({ name: spotifyName }), track({ name: youtubeName }))?.tier).toBe('strong')
  })

  test('a vocalist credit after a pipe is not a variant', () => {
    // "female" and "male" stay bracket-only: a pipe is where uploads credit
    // their singers this way.
    expect(scorePair(track(), track({ name: 'Antidote | Female Vocals: Jasmine Sandlas' }))?.tier).toBe('strong')
  })

  test('a variant named in the first tail segment still vetoes, even with a credit chain after it', () => {
    const result = scorePair(
      track({ name: 'Gal Dil Di' }),
      track({ name: 'Gal Dil Di (Duet Version 1) | Some Channel' }),
    )
    expect(result).toBeNull()
  })

  // Audit root cause 1: only the tail's FIRST bracket used to be checked, and
  // a leading credit always takes that slot. '(feat. X)' comes before the
  // version tag in ordinary storefront metadata, so the commonest way to name
  // a variant of a feat track walked straight past the veto to strong.
  test.each([
    'Antidote (feat. Ikky) (Remix)',
    'Antidote (From "Making Memories") (Instrumental)',
    'Antidote - Karan Aujla (8D Audio)',
  ])('a variant tag after a leading credit is vetoed, not waved through as strong: %s', (name) => {
    expect(scorePair(track(), track({ name }))).toBeNull()
  })

  test('a later bracket that is only decoration still lets the title through', () => {
    // The other half of the pair above: checking every bracket must not turn
    // an ordinary second bracket into a veto.
    expect(scorePair(track(), track({ name: 'Antidote (feat. Ikky) (Official Video)' })).tier).toBe('strong')
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

  // Audit root cause 4: the dice veto above read only the YouTube title's
  // tail. A variant named in the base of the title (no separator at all), or
  // on the Spotify side, cleared the floor with nothing checking it. The
  // asserted dice score is what proves each pair reaches the dice path.
  test.each([
    ['Kihnu Yaad Kar Kar Hasdi', 'Kihnu Yaad Kar Kar Hasdi Live'],
    ['Tumse Milke Dilka Jo Haal (Lofi)', 'Tumse Milke Dilka Jo Haal'],
    ['Jaan Se Guzarte Hain Dil Pe Zakham Khate Hain Live', 'Jaan Se Guzarte Hain Dil Pe Zakham Khate Hain Lofi'],
    ['Jaan Se Guzarte Hain Dil Pe Zakham Khate Hain (Part 2)', 'Jaan Se Guzarte Hain Dil Pe Zakham Khate Hain'],
  ])('titles that name different variants are not proposed on the dice path: %s / %s', (spotifyName, youtubeName) => {
    expect(diceCoefficient(matchText(spotifyName), matchText(youtubeName))).toBeGreaterThanOrEqual(FUZZY_FLOOR)
    expect(scorePair(track({ name: spotifyName }), track({ name: youtubeName }))).toBeNull()
  })

  test.each([
    // The same variant on both sides is the same recording.
    ['Kihnu Yaad Kar Kar Hasdi Live', 'Kihnu Yaad Kar Kar Hasdii Live'],
    // Spelt differently, still the same variant.
    ['Tumse Milke Dilka Jo Haal (Lo-Fi)', 'Tumse Milke Dilka Jo Haal Lofi'],
    // A vocalist credit after a pipe names no variant here either, exactly as
    // on the lead path. Measured: dice 0.906.
    [
      'Tujhe Dekha To Yeh Jaana Sanam Pyaar Hota Hai Deewana Sanam',
      'Tujhe Dekha To Yeh Jaana Sanam Pyaar Hota Hai Deewana Sanamm | Male Vocal',
    ],
  ])('titles that name the same variants are still likely on the dice path: %s / %s', (spotifyName, youtubeName) => {
    expect(scorePair(track({ name: spotifyName }), track({ name: youtubeName })).tier).toBe('likely')
  })

  // A transliteration spelt two ways ("Sutya" / "Sutiya") scores below the
  // fuzzy floor, so the length has to carry the evidence instead: a looser
  // title is accepted only when the two run within a few seconds.
  test('a spelling variant whose length agrees is likely', () => {
    // Verbatim from the live libraries: Spotify and YouTube, same song.
    const spotify = track({ name: 'Maar Sutya', ...credits('Amrinder Gill', 'Sukshinder Shinda'), durationMs: 239106 })
    const youtube = track({ name: 'Maar Sutiya', ...credits('Amrinder Gill'), durationMs: 237000 })
    expect(diceCoefficient(matchText(spotify.name), matchText(youtube.name))).toBeLessThan(FUZZY_FLOOR)
    expect(scorePair(spotify, youtube)?.tier).toBe('likely')
  })

  test('a spelling variant is accepted up to the spelling window and no further', () => {
    const spotify = track({ name: 'Maar Sutya', durationMs: 239000 })
    expect(scorePair(spotify, track({ name: 'Maar Sutiya', durationMs: 239000 + SPELLING_DRIFT_MS }))?.tier).toBe('likely')
    expect(scorePair(spotify, track({ name: 'Maar Sutiya', durationMs: 239000 + SPELLING_DRIFT_MS + 1 }))).toBeNull()
  })

  test.each([
    // All three are in the live libraries, and each scores just under the
    // fuzzy floor: the number is the only thing that differs, and a number is
    // a different song, not a spelling.
    ['Mai Tere Ishq Mein', 'Mai Tere Ishq Mein 2.0'],
    ['Akhiyan Udeekdian', 'Akhiyan Udeekdian 2.0'],
    ["Don't Look", "Don't Look 2"],
  ])('titles that differ by a number are not spelling variants, even at the same length: %s / %s', (spotifyName, youtubeName) => {
    expect(scorePair(track({ name: spotifyName }), track({ name: youtubeName }))).toBeNull()
  })

  // A music video carries an intro, pauses and end credits the album audio
  // does not, so its length is weaker evidence. Each pair is verbatim from
  // the live libraries, and every one went unmatched under the 5s limit.
  test.each([
    ['Saade Pind', ['Khan Bhaini'], 276882, ['Khan Bhaini'], 284000],
    ['Mithi Mithi', ['Amrit Maan', 'Jasmine Sandlas'], 221040, ['Amrit Maan', 'Jasmine Sandlas'], 238000],
    ['Vibe', ['Diljit Dosanjh'], 155250, ['Diljit Dosanjh'], 185000],
    ['Patola', ['Raf Saperra', 'DJ Jesta'], 240066, ['Raf-Saperra', 'DJ Jesta'], 217000],
  ])('an official music video further from the audio length is likely: %s', (name, spotifyArtists, spotifyMs, youtubeArtists, youtubeMs) => {
    const spotify = track({ name, ...credits(...spotifyArtists), durationMs: spotifyMs })
    const youtube = video({ name, ...credits(...youtubeArtists), durationMs: youtubeMs })
    expect(scorePair(spotify, youtube)?.tier).toBe('likely')
  })

  test('a music video is accepted up to the video window either way, and no further', () => {
    expect(scorePair(track(), video({ durationMs: 188000 + VIDEO_MAX_DRIFT_MS }))?.tier).toBe('likely')
    expect(scorePair(track(), video({ durationMs: 188000 - VIDEO_MAX_DRIFT_MS - 1 }))).toBeNull()
  })

  test('an untyped YouTube upload with no album is read as a video', () => {
    // Verbatim from the live libraries.
    const spotify = track({ name: 'Millionaire', ...credits('Yo Yo Honey Singh'), durationMs: 199114 })
    const youtube = track({ name: 'Millionaire', ...credits('Honey Singh'), durationMs: 210000, album: { id: null, name: '' } })
    expect(scorePair(spotify, youtube)?.tier).toBe('likely')
  })

  test.each([
    ['album audio', { videoType: 'MUSIC_VIDEO_TYPE_ATV' }],
    ['an untyped track with an album', { videoType: null }],
  ])('%s keeps the catalogue length limit', (_, kind) => {
    expect(scorePair(track(), track({ ...kind, durationMs: 188000 + MAX_DRIFT_MS + 1 }))).toBeNull()
  })

  test('a spelling variant on a music video still needs the lengths to agree', () => {
    // The video window widens what length tolerates, not what a misspelt
    // title needs: a title and a length that are both loose are no evidence.
    const spotify = track({ name: 'Maar Sutya', durationMs: 239000 })
    expect(scorePair(spotify, video({ name: 'Maar Sutiya', durationMs: 239000 + SPELLING_DRIFT_MS + 1 }))).toBeNull()
  })

  // A Spotify LOCAL file is the user's own audio, tagged by hand. Its artist
  // field is free text, like a YouTube byline, and its length is the length
  // of their copy rather than catalogue data.
  test('a local file credited to joined artists still matches strong', () => {
    const spotify = track({ name: 'Hai Mera Dil', ...credits('Alfaaz; Yo Yo Honey Singh'), durationMs: 210000, isLocal: true })
    const youtube = track({ name: 'Hai Mera Dil', ...credits('Alfaaz'), durationMs: 210000 })
    expect(scorePair(spotify, youtube)?.tier).toBe('strong')
  })

  test('a local file is given a wider length window, as likely', () => {
    // Verbatim from the live libraries: the Spotify side is a local file 7s
    // shorter than YouTube's album audio, and spelt differently.
    const spotify = track({ name: 'Haye Mera Dil', ...credits('Alfaaz; Yo Yo Honey Singh'), durationMs: 203000, isLocal: true })
    const youtube = track({ name: 'Hai Mera Dil', ...credits('Alfaaz'), durationMs: 210000 })
    expect(scorePair(spotify, youtube)?.tier).toBe('likely')
    // The same pair from the Spotify catalogue gets no such allowance.
    expect(scorePair({ ...spotify, isLocal: false }, youtube)).toBeNull()
  })

  test('a local file is accepted up to the local window and no further', () => {
    const spotify = track({ name: 'Hai Mera Dil', durationMs: 210000, isLocal: true })
    expect(scorePair(spotify, track({ name: 'Hai Mera Dil', durationMs: 210000 + LOCAL_MAX_DRIFT_MS }))?.tier).toBe('likely')
    expect(scorePair(spotify, track({ name: 'Hai Mera Dil', durationMs: 210000 + LOCAL_MAX_DRIFT_MS + 1 }))).toBeNull()
  })

  test('a local file still needs an artist in common', () => {
    // Verbatim from the live libraries: the same title sung by someone else.
    const spotify = track({ name: 'Putt Jatt Da', ...credits('Diljit Dosanjh'), durationMs: 164000, isLocal: true })
    const youtube = track({ name: 'Putt Jatt Da', ...credits('Simiran Kaur Dhadli', 'Desi Trap Music'), durationMs: 156000 })
    expect(scorePair(spotify, youtube)).toBeNull()
  })

  test('an exact live-to-live match still reaches strong (the dice-veto exception)', () => {
    const result = scorePair(track({ name: 'Antidote (Live)' }), track({ name: 'Antidote (Live)' }))
    expect(result.tier).toBe('strong')
  })

  // C-1: the veto used to exempt a pipe-led tail wholesale, so a single `|`
  // disabled every word in VARIANT_TAIL. Pipe segments are now checked
  // against PIPE_VARIANT_TAIL.
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

  test('a variant in a parenthesised tail is still vetoed by the full list', () => {
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

  // Audit root cause 6: I-1 REFUSED an artist lead instead of reading past it
  // to the song, which lost every artist-first upload. Each YouTube title
  // here is verbatim from the live library.
  test.each([
    ['Vanilla', 'Diljit Dosanjh - VANILLA (Visualiser) | Drive Thru'],
    ['Ghost', 'Diljit Dosanjh | Ghost (Official Video) | Born To Shine Tour | Australia | Thiarajxtt'],
    ['Caviar', 'Diljit Dosanjh: Caviar (Official Music Video) Intense | Raj Ranjodh | Drive Thru'],
  ])('an artist-first title is read past the artist to the song: %s', (spotifyName, youtubeName) => {
    const diljit = credits('Diljit Dosanjh')
    expect(scorePair(track({ name: spotifyName, ...diljit }), track({ name: youtubeName, ...diljit }))?.tier).toBe('strong')
  })

  test('an artist-first title is read past an artist credited second, too', () => {
    // The lead is checked against every credited artist, not only the
    // primary: here YouTube credits the producer first.
    const spotify = track({ name: 'Excuses', ...credits('AP Dhillon') })
    const youtube = track({ name: 'AP Dhillon - Excuses (Official Video)', ...credits('Intense', 'AP Dhillon') })
    expect(scorePair(spotify, youtube)?.tier).toBe('strong')
  })

  test.each([
    'Diljit Dosanjh - Vanilla (Remix)',
    'Diljit Dosanjh: Vanilla (Remix)',
  ])('a variant after the song in an artist-first title still vetoes: %s', (name) => {
    const diljit = credits('Diljit Dosanjh')
    expect(scorePair(track({ name: 'Vanilla', ...diljit }), track({ name, ...diljit }))).toBeNull()
  })

  test('a colon with no space before it is only a cut after a credited artist', () => {
    // Anywhere else it is part of the title. A general colon cut reads this
    // as 'Mission' and matches a different song of that name.
    expect(scorePair(track({ name: 'Mission' }), track({ name: 'Mission: Impossible' }))).toBeNull()
  })

  // Audit root cause 7: decoration was cut from the YouTube title alone, and
  // only when nothing in its tail named a variant. Both titles are now
  // reduced the same way: the lead, plus every segment that names a variant.
  test.each([
    // A Spotify subtitle against YouTube's credits. The title is a real
    // live-library one; the piped credits are the library's usual shape.
    ['P.O.V (Point of View)', 'P.O.V (Point of View) | Karan Aujla | Yeah Proof'],
    // Decoration on the Spotify side only.
    ['Antidote (From "Making Memories")', 'Antidote'],
    // The same variant on both sides, with credits on YouTube's. The first
    // title is a real live-library one, wearing a typical video tag.
    ['Yadan Vichre Sajan Dian (Remix)', 'Yadan Vichre Sajan Dian (Remix) (Official Video)'],
    ['Antidote - Trap Mix', 'Antidote - Trap Mix (Official Visualizer)'],
    ['Antidote (Part 2)', 'Antidote (Part 2) (Official Video)'],
  ])('both titles shed their decoration and keep their variants: %s / %s', (spotifyName, youtubeName) => {
    expect(scorePair(track({ name: spotifyName }), track({ name: youtubeName }))?.tier).toBe('strong')
  })

  test.each([
    // The variant on one side only.
    ['Antidote', 'Antidote (Remix) (Official Video)'],
    ['Antidote (Remix)', 'Antidote (Official Video)'],
    // A different variant on each side.
    ['Antidote (Remix)', 'Antidote (Live) (Official Video)'],
  ])('titles whose variants differ are still not proposed: %s / %s', (spotifyName, youtubeName) => {
    expect(scorePair(track({ name: spotifyName }), track({ name: youtubeName }))).toBeNull()
  })

  test('an artist-first title whose next part is another artist is still refused', () => {
    // 'Ikky - Karan Aujla' is two credits, not a song called 'Karan Aujla'.
    const spotify = track({ name: 'Karan Aujla', ...credits('Karan Aujla') })
    const youtube = track({ name: 'Ikky - Karan Aujla (Official Video)', ...credits('Ikky', 'Karan Aujla') })
    expect(scorePair(spotify, youtube)).toBeNull()
  })

  // The two veto lists once had INVERTED strictness: a parenthesised tag is
  // the more canonical way to mark a variant, yet '(Acapella)',
  // '(Bassboosted)' and '(8-D Audio)' all reached strong while their piped
  // forms were correctly vetoed. The looser list was guarding the safer
  // position.
  test('a variant word strict enough for a pipe segment always vetoes a tag too', () => {
    const pipe = alternatives(PIPE_VARIANT_TAIL)
    const full = alternatives(VARIANT_TAIL)

    // Guard the split itself, so this cannot pass vacuously or on a
    // mis-parsed pattern.
    expect(pipe.length).toBeGreaterThan(0)
    expect(full.length).toBeGreaterThan(pipe.length)
    expect(pipe.filter((word) => !isBalanced(word))).toEqual([])
    expect(full.filter((word) => !isBalanced(word))).toEqual([])

    // The invariant. Derived from the patterns, so adding a word to the pipe
    // list and forgetting the full one fails here by name.
    expect(pipe.filter((word) => !full.includes(word))).toEqual([])
  })

  test.each([
    'Acapella',
    'A Cappella',
    'Acappella',
    'Bassboosted',
    '8-D Audio',
    '8 D Audio',
  ])('a parenthesised %s is vetoed, the same as its piped form', (word) => {
    // The six spellings that were actually inverted. The spaced forms
    // ('Bass Boosted', '8D Audio') were already covered by the full list.
    expect(scorePair(track(), track({ name: `Antidote (${word})` }))).toBeNull()
    expect(scorePair(track(), track({ name: `Antidote | ${word}` }))).toBeNull()
  })

  // I-2: artist names fold with sortKey LAYERED OVER matchText. Each helper
  // alone drops one of these two tests, so the pair of them pins both halves
  // of the composition. See foldArtist in scorePair.js.
  test('an artist differing only by punctuation still matches', () => {
    // The sortKey half alone fails this: sortKey does not fold punctuation,
    // so 'jay-z' !== 'jay z' and the pair is dropped outright. Spotify and
    // YouTube genuinely spell this artist differently.
    const spotify = track({
      name: 'Public Service Announcement',
      artists: [{ id: 'j1', name: 'Jay-Z' }],
      primaryArtist: { id: 'j1', name: 'Jay-Z' },
    })
    const youtube = track({
      name: 'Public Service Announcement',
      artists: [{ id: 'j2', name: 'JAY Z' }],
      primaryArtist: { id: 'j2', name: 'JAY Z' },
    })
    expect(scorePair(spotify, youtube).tier).toBe('strong')
  })

  test('an artist differing only by a leading article still matches', () => {
    // The matchText half alone fails this: matchText keeps the article, so
    // 'the prophec' !== 'prophec'. csv/match.js calls these the same artist,
    // so this module must too, or a later deliverable adds the track twice.
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

  // Audit root cause 5: YouTube often holds a whole byline as ONE artist
  // entry, which never equalled any of Spotify's separate artists. Each row
  // below is a joined credit taken verbatim from the live library.
  test.each([
    [['AP Dhillon', 'Amari'], 'AP Dhillon & Amari'],
    [['Ekam Sudhar', 'Manni Sandhu', 'Rav Hanjra'], 'Ekam Sudhar, Manni Sandhu & Rav Hanjra'],
    [['Inder Chahal', 'Karan Aujla'], 'Inder Chahal and Karan Aujla'],
    [['Money Aujla', 'Nesdi Jones'], 'Money Aujla Feat Nesdi Jones'],
  ])('a byline joined into one YouTube entry still matches: %j vs %s', (spotifyNames, byline) => {
    const spotify = track(credits(...spotifyNames))
    const youtube = track(credits(byline))
    expect(scorePair(spotify, youtube)?.tier).toBe('strong')
  })

  test('a Spotify artist who is not first in the joined byline still matches strong', () => {
    expect(scorePair(track(credits('Karan Aujla')), track(credits('Inder Chahal and Karan Aujla')))?.tier).toBe('strong')
  })

  // Owner decision: artist ORDER and COUNT do not matter. With the exact title
  // and the length within the strong window, any artist in common is a strong
  // match. Both rows are verbatim titles and artists from the live libraries.
  test('the same artists credited in a different order still match strong', () => {
    const spotify = track({ name: "SWITCHIN' LANES", ...credits('Tegi Pannu', 'Sukha', 'Manni Sandhu') })
    const youtube = track({ name: "SWITCHIN' LANES", ...credits('Sukha', 'Manni Sandhu', 'Tegi Pannu') })
    expect(scorePair(spotify, youtube)?.tier).toBe('strong')
  })

  test.each([
    // Spotify credits two, YouTube one — and not Spotify's first.
    [['SARRB', 'Starboy X'], 'Kamlee', ['Starboy X'], 'KAMLEE (Official Video) SARRB | Starboy X'],
    // YouTube credits three, Spotify one, and not first.
    [['Karan Aujla'], 'Antidote', ['Ikky', 'Karan Aujla', 'Mxrci'], 'Antidote'],
  ])('a different number of credited artists still matches strong: %j / %j', (spotifyArtists, spotifyName, youtubeArtists, youtubeName) => {
    const spotify = track({ name: spotifyName, ...credits(...spotifyArtists) })
    const youtube = track({ name: youtubeName, ...credits(...youtubeArtists) })
    expect(scorePair(spotify, youtube)?.tier).toBe('strong')
  })

  test('a strong match on an artist in common does not claim the artists match exactly', () => {
    // The reason is what the confirmation UI shows beside the pair.
    const youtube = track(credits('Ikky', 'Karan Aujla'))
    expect(scorePair(track(), youtube)?.reason).toBe('Title matches exactly, and an artist is credited on both')
  })

  test('an artist in common outside the strong window is still likely, and says why', () => {
    const youtube = track({ ...credits('Ikky', 'Karan Aujla'), durationMs: 188000 + STRONG_DRIFT_MS + 1 })
    expect(scorePair(track(), youtube)?.reason).toBe('A different artist is credited first, the durations differ by 3s')
  })

  test('a duo credited as one name on both services still matches strong', () => {
    // The whole credit has to stay a candidate alongside its parts: split
    // into 'Vishal' and 'Shekhar' alone, neither equals Spotify's one entry
    // and the pair is lost outright.
    expect(scorePair(track(credits('Vishal-Shekhar')), track(credits('Vishal & Shekhar')))?.tier).toBe('strong')
  })

  // Audit root cause 9: the artist fold was literal about spacing and about a
  // leading honorific. YouTube credits 'KS Makhan' and both 'Ustad Nusrat
  // Fateh Ali Khan' and 'Nusrat Fateh Ali Khan' in the live library.
  test.each([
    ['K.S. Makhan', 'KS Makhan'],
    ['A.R. Rahman', 'AR Rahman'],
    ['Sidhu Moose Wala', 'Sidhu Moosewala'],
    ['Nusrat Fateh Ali Khan', 'Ustad Nusrat Fateh Ali Khan'],
    ['Ustad Nusrat Fateh Ali Khan', 'Nusrat Fateh Ali Khan'],
    ['Pt. Jasraj', 'Pandit Jasraj'],
  ])('the same artist spelt %s and %s still matches strong', (spotifyName, youtubeName) => {
    expect(scorePair(track(credits(spotifyName)), track(credits(youtubeName)))?.tier).toBe('strong')
  })

  // Audit root cause 10: a stage name spelt two ways. The live library credits
  // both 'Yo Yo Honey Singh' and 'Honey Singh'.
  test.each([
    ['Yo Yo Honey Singh', 'Honey Singh'],
    ['Honey Singh', 'YO YO HONEY SINGH'],
  ])('a known stage-name alias %s / %s still matches strong', (spotifyName, youtubeName) => {
    expect(scorePair(track(credits(spotifyName)), track(credits(youtubeName)))?.tier).toBe('strong')
  })

  // Audit root cause 11: matchText keeps only a-z and 0-9, so a non-Latin
  // title folded to '' and never matched anything.
  test.each([
    ['ਮੇਰਾ ਮਨੁ ਲੋਚੈ', 'ਮੇਰਾ ਮਨੁ ਲੋਚੈ'],
    ['तुम ही हो', 'तुम ही हो'],
    // Decoration is still set aside around a non-Latin title.
    ['ਮੇਰਾ ਮਨੁ ਲੋਚੈ', 'ਮੇਰਾ ਮਨੁ ਲੋਚੈ (Official Video)'],
  ])('a non-Latin title still matches strong: %s / %s', (spotifyName, youtubeName) => {
    expect(scorePair(track({ name: spotifyName }), track({ name: youtubeName }))?.tier).toBe('strong')
  })

  test('a non-Latin artist name still matches strong', () => {
    const spotify = track(credits('ਭਾਈ ਹਰਜਿੰਦਰ ਸਿੰਘ'))
    const youtube = track(credits('ਭਾਈ ਹਰਜਿੰਦਰ ਸਿੰਘ'))
    expect(scorePair(spotify, youtube)?.tier).toBe('strong')
  })

  test.each([
    // The same fold made a MIXED title keep only its Latin words, so two
    // different Gurmukhi songs that both end in "(Live)" both read as "live"
    // and met as strong.
    ['ਮੇਰਾ ਮਨੁ ਲੋਚੈ (Live)', 'ਕੋਈ ਹੋਰ ਗੀਤ (Live)'],
    ['ਮੇਰਾ ਮਨੁ ਲੋਚੈ', 'ਕੋਈ ਹੋਰ ਗੀਤ'],
    ['तुम ही हो', 'तुम ही हो (Lofi)'],
  ])('different non-Latin titles are not proposed: %s / %s', (spotifyName, youtubeName) => {
    expect(scorePair(track({ name: spotifyName }), track({ name: youtubeName }))).toBeNull()
  })

  test.each([
    // 'Dr' is part of a stage name, not an honorific: the live library
    // credits 'Dr. Zeus'.
    ['Dr. Zeus', 'Zeus'],
    // Different artists who share a surname. All three are in the library.
    ['Shinda Kahlon', 'Kahlon'],
    ['Savi Kahlon', 'Shinda Kahlon'],
  ])('different artists %s and %s are still not proposed', (spotifyName, youtubeName) => {
    expect(scorePair(track(credits(spotifyName)), track(credits(youtubeName)))).toBeNull()
  })
})

/** Artists in credit order, as both services' tracks carry them. */
function credits(...names) {
  const artists = names.map((name) => ({ id: null, name }))
  return { artists, primaryArtist: artists[0] }
}
