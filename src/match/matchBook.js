/**
 * The match book: every pairing decision the user has made, kept so the same
 * pair is never asked about twice (mirror design §8, D16).
 *
 * Pure apart from the storage it is handed, which is injected exactly as the
 * undo snapshots' is (src/plan/undo.js), so it tests without a browser. See
 * docs/2026-10-05-match-review-design.md §4.
 */

const KEY = 'playlist-sorter:match-book'
const VERDICTS = new Set(['same', 'different'])

/**
 * The key a Spotify track's decisions are filed under: its id, or for a local
 * file — which has none — its `spotify:local:…` URI.
 */
export function spotifyKeyOf(track) {
  return track?.id ?? track?.uri ?? null
}

/** Every stored decision. A missing, blocked or unreadable store is an empty book. */
export function loadMatchBook(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isDecision).map(withValidFind) : []
  } catch {
    return []
  }
}

/**
 * Store the book. False when the browser refuses — private browsing, blocked
 * site data — in which case the session still works and simply does not
 * persist.
 */
export function saveMatchBook(book, storage = globalThis.localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify(book))
    return true
  } catch {
    return false
  }
}

/**
 * The book with this pair's decision set, replacing any earlier one. A
 * confirmed find carries a snapshot of the found track (D29).
 */
export function recordDecision(book, { spotifyKey, youtubeVideoId, verdict, found }, decidedAt = Date.now()) {
  const entry = { spotifyKey, youtubeVideoId, verdict, decidedAt }
  if (found) entry.found = found
  return [...forgetDecision(book, spotifyKey, youtubeVideoId), entry]
}

/**
 * What a confirmed find keeps of the found track. The track is in neither
 * playlist, so after a reload nothing else knows it (catalogue search design
 * §7). `uri` is what a Plan C add to Spotify needs.
 *
 * @param {object} track
 * @param {'youtube'|'spotify'} side which service the track is from
 */
export function snapshotOf(track, side) {
  return {
    side,
    name: track?.name ?? '',
    artists: (track?.artists ?? []).map((artist) => artist?.name ?? ''),
    durationMs: track?.durationMs ?? 0,
    videoType: track?.videoType ?? null,
    uri: track?.uri ?? null,
  }
}

/** The found track a decision's snapshot describes, in the app's Track shape. */
export function trackFromSnapshot(decision) {
  const { found } = decision
  const artists = found.artists.map((name) => ({ id: null, name }))
  return {
    id: found.side === 'youtube' ? decision.youtubeVideoId : decision.spotifyKey,
    uri: found.uri,
    name: found.name,
    artists,
    primaryArtist: artists[0] ?? null,
    album: { id: null, name: '', releaseDate: null, releaseDatePrecision: null },
    durationMs: found.durationMs,
    videoType: found.videoType,
    source: found.side,
    isLocal: false,
    isUnavailable: false,
    isEpisode: false,
  }
}

/** The book without this pair's decision. */
export function forgetDecision(book, spotifyKey, youtubeVideoId) {
  return book.filter((entry) => entry.spotifyKey !== spotifyKey || entry.youtubeVideoId !== youtubeVideoId)
}

/**
 * A constant-time lookup for pairing's `verdictFor`, built once per book.
 * Settling asks it about every Spotify-by-YouTube pair — 160,930 times for
 * the live playlists — so a scan of the book per question is not an option.
 */
export function verdictLookup(book) {
  const verdicts = new Map(book.map((entry) => [pairKey(entry.spotifyKey, entry.youtubeVideoId), entry.verdict]))
  return (spotifyKey, youtubeVideoId) => verdicts.get(pairKey(spotifyKey, youtubeVideoId)) ?? null
}

function pairKey(spotifyKey, youtubeVideoId) {
  return `${spotifyKey}\u0000${youtubeVideoId}`
}

function isDecision(entry) {
  return (
    typeof entry?.spotifyKey === 'string' &&
    typeof entry?.youtubeVideoId === 'string' &&
    VERDICTS.has(entry?.verdict)
  )
}

/** A decision whose `found` is not a snapshot keeps the decision and loses the `found`. */
function withValidFind(entry) {
  if (entry.found === undefined || isSnapshot(entry.found)) return entry
  const kept = { ...entry }
  delete kept.found
  return kept
}

function isSnapshot(found) {
  return (
    (found?.side === 'youtube' || found?.side === 'spotify') &&
    typeof found.name === 'string' &&
    Array.isArray(found.artists) &&
    Number.isFinite(found.durationMs)
  )
}
