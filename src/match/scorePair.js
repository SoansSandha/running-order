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
 * plural, so "Alternate Versions" vetoes the same as "Alternate Version";
 * remix, reverb and reprise also match their past tense ("Remixed by X",
 * "Reverbed"), and boost its bare form ("Bass Boost").
 *
 * A bare mood or voice tag ("(Sad)", "(Female)", "(Male)") names a recording
 * sung again, as "(Female Version)" already did through "version".
 *
 * Spatial-audio re-uploads come in every numeral (3D, 9D, 16D...), but the
 * numeral form is tied to the word "audio" except for the two common bare
 * tags, 8D and 16D. A bare numeral-D would veto "(2D Animated Video)" and
 * "(3D Video)" too, and those are the same recording with different pictures.
 *
 * No token may contain a `|`, even inside a group: the superset test in
 * scorePair.test.js splits these patterns on it. Use a character class
 * instead (`remix(?:e[sd])?`, not `remix(?:es|ed)?`).
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
  /\b(live|remix(?:e[sd])?|rmx|version(?:s)?|acoustic|unplugged|slowed|reverb(?:ed)?|cover(?:s)?|instrumental|inst|duet|mix(?:es)?|edit(?:s)?|reprised?|demo|karaoke|mashup|medley|nightcore|boosted|bass[\s-]?boost(?:ed)?|extended|8[\s-]?d|16[\s-]?d|\d{1,2}[\s-]?d[\s-]?audio|lo[\s-]?fi|sped[\s-]?up|a[\s-]?cappella|acapella|minus[\s-]?one|without[\s-]?vocals?|sad|female|male)\b/i

/**
 * What a PIPE segment is checked against (C-1): every word of VARIANT_TAIL
 * except "female" and "male", which a pipe is where uploads credit their
 * singers ("| Female Vocals: X").
 *
 * A pipe segment is usually a credit — a channel, a featured artist, a
 * producer, a "Latest Punjabi Songs 2025" tag. But `SONG | ARTIST | BASS
 * BOOSTED | TAG` is the same upload convention, so a pipe segment can equally
 * name a different recording, and a blanket exemption for pipes turned every
 * word above into a no-op behind a single `|`.
 *
 * Owner decision: Spotify is the source of truth, so a variant named after a
 * pipe vetoes the way a bracket does — unless Spotify's own title names the
 * same variant, which essentialTitle keeps on both sides. This list used to
 * leave out mix, edit, version, cover, demo, remix and live to protect
 * credits that contain them; that let `| Live` and `| Remix` reach strong.
 * The accepted cost is that a spaced credit such as "| Mix Singh" or "| Cover
 * Art by X" now vetoes too. "MixSingh" as one word still passes, because of
 * the trailing \b. Measured on the live library: of 60 pipe segments, this
 * vetoes two more, both genuine variants ("| Hip Hop/Trap Mix", "| Remix
 * #instagram"), and the library holds no spaced "Mix Singh".
 */
export const PIPE_VARIANT_TAIL =
  /\b(live|remix(?:e[sd])?|rmx|version(?:s)?|acoustic|unplugged|slowed|reverb(?:ed)?|cover(?:s)?|instrumental|inst|duet|mix(?:es)?|edit(?:s)?|reprised?|demo|karaoke|mashup|medley|nightcore|boosted|bass[\s-]?boost(?:ed)?|extended|8[\s-]?d|16[\s-]?d|\d{1,2}[\s-]?d[\s-]?audio|lo[\s-]?fi|sped[\s-]?up|a[\s-]?cappella|acapella|minus[\s-]?one|without[\s-]?vocals?|sad)\b/i

/**
 * A tail segment that OPENS with a sequel marker — "(Part 2)", " - Pt. 2",
 * " | Part II" — names a different song, under any separator.
 *
 * Anchored to the start of the segment, and kept out of VARIANT_TAIL, because
 * film sequels are named the same way: `(From "Carry On Jatta Part 2")` carries
 * the words and is the original song credited to its film. As a free word in
 * the list it would veto every song from a sequel film.
 */
const SEQUEL_SEGMENT = /^\s*[|([–—:-]\s*(?:part|pt\.?)\s*(?:\d+|[ivx]+)\b/i

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
 *   behind one pipe character. So every pipe segment is checked, against
 *   PIPE_VARIANT_TAIL: the full list less the two words pipe credits use for
 *   singers, so "Antidote | Female Vocals: X" still matches while "Antidote |
 *   Karaoke" is vetoed.
 * - Under either separator, a segment that opens with a sequel marker is a
 *   different song (SEQUEL_SEGMENT).
 */
function tailNamesVariant(title) {
  const text = String(title ?? '')
  const cut = text.search(TAIL_START)
  if (cut === -1) return false

  return tailSegments(text.slice(cut)).some(segmentNamesVariant)
}

/** Whether one tail segment names a different recording, by the rules above. */
function segmentNamesVariant({ separator, text }) {
  return SEQUEL_SEGMENT.test(text) || vetoListFor(separator).test(text)
}

/** The list a tail segment is read against, by the separator that opened it. */
function vetoListFor(separator) {
  return separator === '|' ? PIPE_VARIANT_TAIL : VARIANT_TAIL
}

/**
 * Every variant a WHOLE title names — its base as well as its tail — folded so
 * that "Lo-Fi", "Lo Fi" and "Lofi" agree.
 *
 * The base is read against the full list, which is how a bare suffix with no
 * separator at all ("Kihnu Yaad Kar Kar Hasdi Live") is seen. Tail segments
 * are read by the same per-separator rule as tailNamesVariant, so a singer
 * credit like "| Male Vocal" names nothing here either.
 */
function namedVariants(title) {
  const text = String(title ?? '')
  const cut = text.search(TAIL_START)
  const parts =
    cut === -1
      ? [{ separator: '', text }]
      : [{ separator: '', text: text.slice(0, cut) }, ...tailSegments(text.slice(cut))]

  const names = new Set()
  for (const { separator, text: part } of parts) {
    for (const word of part.match(new RegExp(vetoListFor(separator).source, 'gi')) ?? []) {
      names.add(word.toLowerCase().replace(/[^a-z0-9]/g, ''))
    }
    // The base never opens with a separator, so only a tail segment can match.
    if (SEQUEL_SEGMENT.test(part)) names.add('sequel')
  }
  return names
}

/** Whether two titles name exactly the same variants (audit root cause 4). */
function sameVariants(a, b) {
  const left = namedVariants(a)
  const right = namedVariants(b)
  return left.size === right.size && [...left].every((name) => right.has(name))
}

/**
 * Fold an ARTIST name for comparison. Titles do NOT use this — they fold with
 * foldTitle.
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
 *
 * Audit root cause 9: on top of that, spacing is ignored and a leading
 * musical honorific is dropped. Dotted initials fold to single letters
 * ("K.S. Makhan" is "k s makhan" against "KS Makhan"), compound names split
 * differently between services ("Sidhu Moose Wala" / "Sidhu Moosewala"), and
 * the live library credits both "Ustad Nusrat Fateh Ali Khan" and "Nusrat
 * Fateh Ali Khan". Two different artists whose names differ only in spacing
 * would also have to share a title and a length to be proposed.
 *
 * Only ustad, pandit and pt. count as honorifics. "Dr" is part of stage
 * names ("Dr. Zeus" is in the library); bhai, sant and baba are carried the
 * same way by both services in kirtan credits, and "Baba Sehgal" is a stage
 * name too. A shorter name inside a longer one is NOT folded together
 * either: "Kahlon", "Savi Kahlon" and "Shinda Kahlon" are three artists.
 */
function foldArtist(name) {
  if (NON_LATIN_LETTER.test(String(name ?? ''))) return foldAnyScript(name).replace(/ /g, '')
  const folded = sortKey(matchText(name)).replace(HONORIFIC, '').replace(/ /g, '')
  return ARTIST_ALIASES.get(folded) ?? folded
}

/**
 * Fold a TITLE for comparison: matchText, unless the title holds a non-Latin
 * letter (audit root cause 11).
 *
 * matchText keeps only a-z and 0-9. So a title in Gurmukhi, Devanagari or any
 * other non-Latin script folded to '' and could never match, and a MIXED
 * title folded to its Latin words alone — two different Gurmukhi songs that
 * both end in "(Live)" both read as "live" and met as strong.
 */
function foldTitle(text) {
  return NON_LATIN_LETTER.test(String(text ?? '')) ? foldAnyScript(text) : matchText(text)
}

/** A letter outside the Latin script. */
const NON_LATIN_LETTER = /(?=\p{L})\P{Script=Latin}/u

/**
 * Fold text in any script, keeping every script's letters, marks and digits.
 *
 * The marks are why this cannot reuse matchText's diacritic strip: in
 * Gurmukhi and Devanagari, vowel signs and the virama are marks, and
 * stripping them turns different words into the same one.
 */
function foldAnyScript(value) {
  return String(value ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/['‘’]/g, '')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim()
}

const HONORIFIC = /^(?:ustad|pandit|pt) (?=\S)/

/**
 * Stage names spelt two ways (audit root cause 10), keyed and valued as
 * foldArtist folds them. Seeded ONLY from names a real library credits both
 * ways — no general rule can tell "Honey Singh" from "Yo Yo Honey Singh"
 * without also merging "Kahlon" into "Shinda Kahlon". Add a pair when a
 * library shows one.
 */
const ARTIST_ALIASES = new Map([
  // The live library credits both.
  ['yoyohoneysingh', 'honeysingh'],
])

/**
 * A title reduced to what identifies the RECORDING, folded: its lead plus
 * every tail segment that names a variant, with every other segment —
 * credits, film tags, "(Official Video)" — dropped. '' when the title has no
 * lead that could be a song title.
 *
 * M5: measured against the live library, 72 of 384 YouTube titles carry a
 * tail, and the folded full title scores as low as 0.48 against the clean
 * Spotify one — so without this, a fifth of the playlist reports as
 * unmatched, and in 2c every one of those would be "filled" as a duplicate of
 * a track already present.
 *
 * Audit root cause 7: both titles are reduced, by the same rule. Cutting only
 * YouTube's lost a Spotify subtitle or film tag ('P.O.V (Point of View)',
 * 'Kesariya (From "Brahmastra")'). And a variant segment is KEPT rather than
 * vetoing the cut, so the same variant on both sides still meets: 'Yadan
 * Vichre Sajan Dian (Remix)' against '... (Remix) (Official Video)'. A variant
 * on one side only leaves the two reductions unequal, which is the veto.
 *
 * I-1: "Karan Aujla - Antidote (Official Video)" cuts to the ARTIST, not to a
 * title, and self-titled tracks and intros are common enough that the
 * fragment then fold-equals a real Spotify title — with the artist gate
 * passing trivially, because YouTube does credit that artist. So a lead that
 * is just an artist's name is never treated as the title. There is
 * deliberately no minimum length instead: "C4", "Magic" and "Snap" are all
 * real titles in the live library and a length floor would drop them.
 *
 * Audit root cause 6: REFUSING such a lead lost every artist-first upload
 * ("Diljit Dosanjh - VANILLA (Visualiser) | Drive Thru"). So when the lead is
 * any credited artist, not only the primary, the title is read from what
 * follows instead, and refused only if that is an artist too.
 *
 * @param {string} title
 * @param {Set<string>} credited that side's artist names, folded
 */
function essentialTitle(title, credited) {
  const split = splitTitle(String(title ?? ''), credited)
  if (!split) return ''
  return foldTitle([split.lead, ...split.segments.filter(segmentNamesVariant).map(({ text }) => text)].join(' '))
}

/**
 * A title's lead and tail segments, read past a leading artist credit; null
 * when there is no lead that could be a title.
 */
function splitTitle(text, credited) {
  const colon = ARTIST_COLON.exec(text)
  if (colon && credited.has(foldArtist(colon[1]))) return splitAfterArtist(text.slice(colon[0].length), credited)

  const tail = TAIL_START.exec(text)
  if (!tail) return { lead: text, segments: [] }
  const lead = text.slice(0, tail.index).trim()
  if (!lead) return null

  if (credited.has(foldArtist(lead))) return splitAfterArtist(text.slice(tail.index + tail[0].length), credited)
  return { lead, segments: tailSegments(text.slice(tail.index)) }
}

/**
 * "Diljit Dosanjh: Caviar" puts no space before its colon, so TAIL_START never
 * sees it. A colon like that is a cut only when what precedes it is a
 * credited artist; anywhere else it belongs to the title ("Mission:
 * Impossible", "9:45").
 */
const ARTIST_COLON = /^([^:]+):\s/

/**
 * The lead and segments of what follows an artist credit, or null when that
 * is an artist too. Its segments are this part's own tail only: the song
 * title now sits in the WHOLE title's tail, and a title word like "Live" in
 * "Live Forever" must not count as a variant segment.
 */
function splitAfterArtist(rest, credited) {
  const cut = rest.search(TAIL_START)
  const lead = (cut === -1 ? rest : rest.slice(0, cut)).trim()
  if (!lead || credited.has(foldArtist(lead))) return null
  return { lead, segments: cut === -1 ? [] : tailSegments(rest.slice(cut)) }
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
 * neither helper is sufficient by itself. Titles fold with foldTitle.
 *
 * Spotify's artists are already separate entries, so they are never split.
 */
function spotifyNames(track) {
  return (track?.artists ?? [])
    .map((artist) => foldArtist(artist?.name))
    .filter(Boolean)
}

/**
 * Where a YouTube byline joins several artists into ONE artist entry (audit
 * root cause 5). Every shape here is measured in the live library, with
 * Spotify listing the same artists separately: "AP Dhillon & Amari", "Ekam
 * Sudhar, Manni Sandhu & Rav Hanjra", "Inder Chahal and Karan Aujla", "Money
 * Aujla Feat Nesdi Jones".
 *
 * " x " is deliberately NOT a joiner, common as it is in Punjabi collab
 * titles: the same library credits an artist called "Starboy X".
 */
const BYLINE_JOINER = /\s*(?:,|&|\band\b|\bfeat(?:uring)?\b\.?|\bft\b\.?)\s*/i

/**
 * Every name a YouTube track's artists can be matched by, folded: each whole
 * entry, plus each artist a joined entry holds. The whole entry has to stay a
 * candidate, or a duo credited as one name on both services ("Vishal-Shekhar"
 * / "Vishal & Shekhar") stops agreeing in full.
 */
function youtubeNames(track) {
  return (track?.artists ?? []).flatMap((artist) => {
    const name = artist?.name
    return [name, ...String(name ?? '').split(BYLINE_JOINER)].map(foldArtist).filter(Boolean)
  })
}

/**
 * What YouTube's PRIMARY artist can be matched by: the whole entry, or the
 * first artist of a joined byline. Never a later one — that is a second or
 * featured artist, and a match on it is only "shares an artist" (M1).
 */
function youtubePrimaryNames(track) {
  const name = track?.primaryArtist?.name
  return [foldArtist(name), foldArtist(String(name ?? '').split(BYLINE_JOINER)[0])].filter(Boolean)
}

/** Any credited artist in common, folded. */
function sharesAnArtist(spotify, youtube) {
  const theirs = new Set(youtubeNames(youtube))
  return spotifyNames(spotify).some((name) => theirs.has(name))
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

  const spotifyTitle = foldTitle(spotify?.name)
  const youtubeTitle = foldTitle(youtube?.name)
  if (!spotifyTitle || !youtubeTitle) return null

  const titleExact = spotifyTitle === youtubeTitle
  // M5: the same title wearing different decoration is still the same title.
  const youtubeEssential = essentialTitle(youtube?.name, new Set(youtubeNames(youtube)))
  const titleViaLead =
    !titleExact &&
    youtubeEssential !== '' &&
    youtubeEssential === essentialTitle(spotify?.name, new Set(spotifyNames(spotify)))
  // M6 applies to the dice path too (I-3): bigram Dice is length-forgiving,
  // so a long enough title still clears the floor with a variant tag still
  // attached. The only exception is a genuine exact-fold match (titleExact),
  // which already short-circuits above and never reaches this branch.
  //
  // The tail check alone reads only YouTube's tail, so both titles must also
  // name the SAME variants: a bare "Live" with no separator, or a "(Lofi)" on
  // the Spotify side, otherwise clears the floor unchecked (audit root cause 4).
  const titleClose =
    titleExact ||
    titleViaLead ||
    (diceCoefficient(spotifyTitle, youtubeTitle) >= FUZZY_FLOOR &&
      !tailNamesVariant(youtube?.name) &&
      sameVariants(spotify?.name, youtube?.name))
  if (!titleClose) return null

  const spotifyPrimary = foldArtist(spotify?.primaryArtist?.name)
  const primaryExact = spotifyPrimary !== '' && youtubePrimaryNames(youtube).includes(spotifyPrimary)

  // M1: a title agreement alone is not evidence. Two different songs share a
  // title far more often than the same song changes its artist.
  //
  // Owner decision (audit root cause 8): an artist named only in the TITLE is
  // not artist evidence either. A label-channel upload credited to the label
  // ("No Need (Full Video) Karan Aujla | ..." by Rehaan Records) stays
  // unproposed — the artist is nearly always in the real upload's own artist
  // tags — and the same rule keeps out the titles that name an artist
  // precisely because they are not by them ("Antidote - Tribute to Karan
  // Aujla").
  if (!primaryExact && !sharesAnArtist(spotify, youtube)) return null

  // Cutting decoration loses nothing, so a lead match is as good as an exact
  // one — the artist and the duration still have to agree (M5, M6).
  if ((titleExact || titleViaLead) && primaryExact && drift <= STRONG_DRIFT_MS) {
    return {
      tier: 'strong',
      durationDeltaMs,
      reason: titleExact
        ? 'Title and artist match exactly'
        : 'Title and artist match once credits and tags are set aside',
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
