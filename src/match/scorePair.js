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
import { sortKey } from '../model/normalize.js'

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
 *
 * INVARIANT: this list is a strict SUPERSET of PIPE_VARIANT_TAIL, token for
 * token. A parenthesised tag is the MORE canonical way to mark a variant, so
 * anything strict enough to veto a pipe segment — where credits live, and
 * where we have to be cautious — is certainly strict enough to veto a tag.
 * The two lists had that backwards once: `(Acapella)`, `(Bassboosted)` and
 * `(8-D Audio)` all reached strong while their piped forms were vetoed.
 * `a variant word strict enough for a pipe segment always vetoes a tag too`
 * derives the check from these two patterns and fails if it ever drifts —
 * which is why both are exported: that test reads their sources.
 */
export const VARIANT_TAIL =
  /\b(live|remix(?:es)?|version(?:s)?|acoustic|unplugged|slowed|reverb|cover(?:s)?|instrumental|duet|mix(?:es)?|edit(?:s)?|reprise|demo|karaoke|mashup|medley|nightcore|boosted|bass[\s-]?boosted|extended|8[\s-]?d|lo-?fi|sped[\s-]?up|a[\s-]?cappella|acapella)\b/i

/**
 * The subset of VARIANT_TAIL that is safe to apply to a PIPE segment (C-1).
 *
 * A pipe segment is usually a credit — a channel, a featured artist, a
 * producer, a "Latest Punjabi Songs 2025" tag. But `SONG | ARTIST | BASS
 * BOOSTED | TAG` is the same upload convention, so a pipe segment can equally
 * name a different recording, and a blanket exemption for pipes turned every
 * word above into a no-op behind a single `|`.
 *
 * So pipes are checked, just against a narrower list: only words that cannot
 * plausibly be part of a person's or a channel's name. The name-collidable
 * members are DELIBERATELY absent — mix, edit, version, cover, demo, remix and
 * live are exactly the words that show up in real credits ("MixSingh",
 * "Mix Singh", "Cover Art by X"), and vetoing on those is what the pipe
 * exemption was originally added to stop. Losing `| Live` and `| Remix` to
 * that carve-out is the accepted cost of not re-breaking those credits.
 */
export const PIPE_VARIANT_TAIL =
  /\b(karaoke|instrumental|bass[\s-]?boosted|8[\s-]?d|nightcore|slowed|reverb|sped[\s-]?up|lo-?fi|unplugged|a[\s-]?cappella|acapella|acoustic|extended|mashup|medley)\b/i

/** Where YouTube starts appending credits, tags and release years. */
// `[` needs no escape inside a character class, and oxlint flags one.
const TAIL_START = /\s[|([]|\s[-–—:]\s/

/** Where one tail segment ends and the next one begins. */
const NEXT_SEGMENT = /\s[|([]/

/**
 * Split a tail into its segments, each tagged with the character that
 * introduced it. Every tail begins with the whitespace TAIL_START matched, so
 * segment[1] is always the separator.
 *
 * @returns {{separator: string, text: string}[]}
 */
function tailSegments(tail) {
  const segments = []
  let rest = tail
  while (rest) {
    const separator = rest[1] ?? ''
    // NEXT_SEGMENT is searched from index 1 so this segment's own separator
    // cannot match it; every step therefore advances by at least one char.
    const next = rest.slice(1).search(NEXT_SEGMENT)
    if (next === -1) {
      segments.push({ separator, text: rest })
      break
    }
    segments.push({ separator, text: rest.slice(0, next + 1) })
    rest = rest.slice(next + 1)
  }
  return segments
}

/**
 * Whether a title's tail — the part TAIL_START finds — names a DIFFERENT
 * RECORDING rather than decoration or a credit (M6).
 *
 * Two lists, because the two kinds of separator carry different risk:
 *
 * - A `(`, a `[`, or a dash/colon set off by spaces introduces a TAG that
 *   describes the recording, so its content is checked against the full
 *   VARIANT_TAIL. EVERY such segment is checked, not just the first: a
 *   leading credit always takes the first slot — `Song (feat. X) (Remix)` is
 *   the ordinary storefront order — so checking only the first segment let
 *   the commonest way of naming a variant of a feat track reach strong.
 * - A `|` usually introduces a CREDIT — a channel, a featured artist, a
 *   "Latest Punjabi Songs 2025" tag — but NOT always: `SONG | ARTIST | BASS
 *   BOOSTED | TAG` is the same upload convention, and exempting pipes
 *   wholesale (as this function used to) silently disabled the entire veto
 *   behind one pipe character. So every pipe segment is checked, against the
 *   narrower PIPE_VARIANT_TAIL, which holds only words that cannot be part of
 *   someone's name. That is what keeps "Antidote | Mix Singh" matching while
 *   "Antidote | Karaoke" is vetoed.
 */
function tailNamesVariant(title) {
  const text = String(title ?? '')
  const cut = text.search(TAIL_START)
  if (cut === -1) return false

  return tailSegments(text.slice(cut)).some(({ separator, text: segment }) =>
    (separator === '|' ? PIPE_VARIANT_TAIL : VARIANT_TAIL).test(segment),
  )
}

/**
 * Fold an ARTIST name for comparison. Titles do NOT use this — they fold with
 * matchText alone.
 *
 * Both halves are load-bearing, and each one fixes a case the other breaks.
 * matchText folds punctuation but keeps a leading article; sortKey strips a
 * leading article but keeps punctuation. Artists need both, because the two
 * services genuinely spell the same artist differently in both ways:
 *
 *   pair                           matchText  sortKey  composed
 *   The PropheC / PropheC            false      true     true
 *   The Weeknd / Weeknd              false      true     true
 *   Jay-Z / JAY Z                    true       false    true
 *   Guns N' Roses / Guns N Roses     true       false    true
 *   AC/DC / AC DC                    true       false    true
 *   Sum 41 / Sum-41                  true       false    true
 *
 * Do NOT "simplify" this to either helper on its own — each single folder
 * silently drops one of those two columns, and a dropped artist agreement is
 * not a demotion here, it is the pair vanishing entirely.
 */
function foldArtist(name) {
  return sortKey(matchText(name))
}

/**
 * The part of a YouTube title before its trailing credits, or null when there
 * is no tail or any segment of the tail names a variant.
 *
 * Measured against the live library: 72 of 384 titles carry such a tail, and
 * the folded full title scores as low as 0.48 against the clean Spotify one —
 * so without this, a fifth of the playlist reports as unmatched, and in 2c
 * every one of those would be "filled" as a duplicate of a track already
 * present.
 *
 * I-1: "Karan Aujla - Antidote (Official Video)" cuts to the ARTIST, not to a
 * title, and self-titled tracks and intros are common enough that the
 * fragment then fold-equals a real Spotify title — with the artist gate
 * passing trivially, because YouTube does credit that artist. So a lead that
 * is just the uploading artist's name is refused. There is deliberately no
 * minimum length instead: "C4", "Magic" and "Snap" are all real titles in the
 * live library and a length floor would drop them.
 *
 * @param {string} title
 * @param {string} [primaryArtistName] the YouTube side's primary artist
 */
export function leadingSegment(title, primaryArtistName) {
  const text = String(title ?? '')
  const cut = text.search(TAIL_START)
  if (cut === -1) return null
  if (tailNamesVariant(title)) return null

  const lead = text.slice(0, cut).trim()
  if (!lead) return null
  const leadKey = foldArtist(lead)
  if (leadKey !== '' && leadKey === foldArtist(primaryArtistName)) return null
  return lead
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

/**
 * I-2: artist names fold with foldArtist, which layers sortKey — the helper
 * csv/match.js keys its artist pools with — over matchText. Folding with
 * matchText alone (the TITLE folder) is what made this module drop a pair
 * outright that csv/match.js calls the same artist. See foldArtist for why
 * neither helper is sufficient by itself. Titles keep using matchText.
 */
function foldedNames(track) {
  return (track?.artists ?? [])
    .map((artist) => foldArtist(artist?.name))
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
  const leadFolded = matchText(leadingSegment(youtube?.name, youtube?.primaryArtist?.name))
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

  const spotifyPrimary = foldArtist(spotify?.primaryArtist?.name)
  const primaryExact = spotifyPrimary !== '' && spotifyPrimary === foldArtist(youtube?.primaryArtist?.name)

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
  // Ceil, not round: at 2001ms Math.round reads "differ by 2s" while 2s is
  // the strong boundary, so two rows in different tiers would show the same
  // delta with contradictory prose. This string is what the confirmation UI
  // shows, so it has to round AWAY from the threshold it just failed.
  if (drift > STRONG_DRIFT_MS) why.push(`the durations differ by ${Math.ceil(drift / 1000)}s`)

  return { tier: 'likely', durationDeltaMs, reason: capitalize(why.join(', ')) }
}

function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text
}
