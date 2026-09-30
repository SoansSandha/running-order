/**
 * Judges whether one Spotify track and one YouTube track are the same track.
 *
 * Pure module: no network, no storage, no React.
 *
 * There is no shared identifier between the services — ytmusicapi returns no
 * ISRC — so this rests on title, artist and duration. Duration is the only
 * one that is hard to fake: a cover, a live cut and a remix all share a title
 * and often an artist, and differ in length.
 *
 * See docs/2026-09-18-youtube-mirror-design.md §7.
 */

import { diceCoefficient, matchText } from '../csv/match.js'

/** Within this, an exact title and artist is as good as it gets. */
export const STRONG_DRIFT_MS = 2000

/** Beyond this, nothing is proposed at any confidence (M2). */
export const MAX_DRIFT_MS = 5000

/** Dice coefficient on character bigrams, as the CSV matcher uses. */
export const FUZZY_FLOOR = 0.9

/**
 * Tails that name a DIFFERENT RECORDING rather than decoration (M6).
 *
 * The same judgement matchText already makes by dropping `(feat. X)` while
 * keeping `(Live)` and `(Remix)`: a duet version of a song is not that song.
 *
 * Both word boundaries are deliberate, and measured. Across 72 real tails the
 * only inflected form of any of these words is "MixSingh" — a producer's
 * name. A trailing-boundary-free pattern would read that as a variant and
 * refuse to cut a title that is only wearing credits. The members that
 * naturally inflect (remix, version, mix, edit, cover) also match their
 * plural, so "Alternate Versions" vetoes the same as "Alternate Version".
 */
const VARIANT_TAIL =
  /\b(live|remix(?:es)?|version(?:s)?|acoustic|unplugged|slowed|reverb|cover(?:s)?|instrumental|duet|mix(?:es)?|edit(?:s)?|reprise|demo|karaoke|mashup|medley|nightcore|boosted|extended|8d|lo-?fi|sped[\s-]?up)\b/i

/** Where YouTube starts appending credits, tags and release years. */
// `[` needs no escape inside a character class, and oxlint flags one.
const TAIL_START = /\s[|([]|\s[-–—:]\s/

/** Where the tail's first segment ends and the next one begins. */
const NEXT_SEGMENT = /\s[|([]/

/**
 * Whether a title's tail — the part TAIL_START finds — names a DIFFERENT
 * RECORDING rather than decoration or a credit (M6).
 *
 * A `|` always introduces a CREDIT in these titles (a channel, a featured
 * artist, a "Latest Punjabi Songs 2025"-style tag) — never a description of
 * the recording itself. So a variant word that only shows up in a LATER
 * credit ("Antidote | Cover Art by X", "Antidote | Mix Singh") must not veto
 * the match; only the tail's first segment is checked, and a pipe-led tail's
 * first segment is empty by definition. A `(`, a `[`, or a dash/colon set off
 * by spaces DOES introduce that kind of tag, and its content — up to
 * wherever the next segment begins — is what gets checked.
 */
function tailNamesVariant(title) {
  const text = String(title ?? '')
  const cut = text.search(TAIL_START)
  if (cut === -1) return false

  const tail = text.slice(cut)
  if (tail[1] === '|') return false

  const next = tail.slice(1).search(NEXT_SEGMENT)
  const segment = next === -1 ? tail : tail.slice(0, next + 1)
  return VARIANT_TAIL.test(segment)
}

/**
 * The part of a YouTube title before its trailing credits, or null when there
 * is no tail or the tail's first segment names a variant.
 *
 * Measured against the live library: 72 of 384 titles carry such a tail, and
 * the folded full title scores as low as 0.48 against the clean Spotify one —
 * so without this, a fifth of the playlist reports as unmatched, and in 2c
 * every one of those would be "filled" as a duplicate of a track already
 * present.
 */
export function leadingSegment(title) {
  const text = String(title ?? '')
  const cut = text.search(TAIL_START)
  if (cut === -1) return null
  if (tailNamesVariant(title)) return null
  return text.slice(0, cut).trim() || null
}

/** Album audio beats a music video beats a user upload, on a tie only (M3). */
const VIDEO_TYPE_RANK = {
  MUSIC_VIDEO_TYPE_ATV: 3,
  MUSIC_VIDEO_TYPE_OMV: 2,
  MUSIC_VIDEO_TYPE_UGC: 1,
}

/** How much a track's own kind is worth when two candidates otherwise tie. */
export function videoTypeRank(track) {
  return VIDEO_TYPE_RANK[track?.videoType] ?? 0
}

function foldedNames(track) {
  return (track?.artists ?? [])
    .map((artist) => matchText(artist?.name))
    .filter(Boolean)
}

/** Any credited artist in common, folded. */
function sharesAnArtist(spotify, youtube) {
  const theirs = new Set(foldedNames(youtube))
  return foldedNames(spotify).some((name) => theirs.has(name))
}

/**
 * @returns {{tier: string, durationDeltaMs: number, reason: string}|null}
 *   null means "do not propose this pair at all"
 */
export function scorePair(spotify, youtube) {
  const spotifyMs = spotify?.durationMs ?? 0
  const youtubeMs = youtube?.durationMs ?? 0
  // No duration on either side leaves nothing but title and artist, which is
  // exactly the evidence a cover or a live cut also satisfies.
  if (spotifyMs <= 0 || youtubeMs <= 0) return null

  const durationDeltaMs = youtubeMs - spotifyMs
  const drift = Math.abs(durationDeltaMs)
  if (drift > MAX_DRIFT_MS) return null

  const spotifyTitle = matchText(spotify?.name)
  const youtubeTitle = matchText(youtube?.name)
  if (!spotifyTitle || !youtubeTitle) return null

  const titleExact = spotifyTitle === youtubeTitle
  // M5: the same title wearing YouTube's credits is still the same title.
  const leadFolded = matchText(leadingSegment(youtube?.name))
  const titleViaLead = !titleExact && leadFolded !== '' && spotifyTitle === leadFolded
  // M6 applies to the dice path too (I-3): bigram Dice is length-forgiving,
  // so a long enough title still clears the floor with a variant tag still
  // attached. The only exception is a genuine exact-fold match (titleExact),
  // which already short-circuits above and never reaches this branch.
  const titleClose =
    titleExact ||
    titleViaLead ||
    (diceCoefficient(spotifyTitle, youtubeTitle) >= FUZZY_FLOOR && !tailNamesVariant(youtube?.name))
  if (!titleClose) return null

  const primaryExact =
    matchText(spotify?.primaryArtist?.name) !== '' &&
    matchText(spotify?.primaryArtist?.name) === matchText(youtube?.primaryArtist?.name)

  // M1: a title agreement alone is not evidence. Two different songs share a
  // title far more often than the same song changes its artist.
  if (!primaryExact && !sharesAnArtist(spotify, youtube)) return null

  // Cutting decoration loses nothing, so a lead match is as good as an exact
  // one — the artist and the duration still have to agree (M5, M6).
  if ((titleExact || titleViaLead) && primaryExact && drift <= STRONG_DRIFT_MS) {
    return {
      tier: 'strong',
      durationDeltaMs,
      reason: titleExact
        ? 'Title and artist match exactly'
        : 'Title and artist match once YouTube’s credits are set aside',
    }
  }

  const why = []
  if (!titleExact && !titleViaLead) why.push('the titles differ slightly')
  if (!primaryExact) why.push('a different artist is credited first')
  if (drift > STRONG_DRIFT_MS) why.push(`the durations differ by ${Math.round(drift / 1000)}s`)

  return { tier: 'likely', durationDeltaMs, reason: capitalize(why.join(', ')) }
}

function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text
}
