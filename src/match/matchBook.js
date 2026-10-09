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
    return Array.isArray(parsed) ? parsed.filter(isDecision) : []
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

/** The book with this pair's decision set, replacing any earlier one. */
export function recordDecision(book, { spotifyKey, youtubeVideoId, verdict }, decidedAt = Date.now()) {
  return [...forgetDecision(book, spotifyKey, youtubeVideoId), { spotifyKey, youtubeVideoId, verdict, decidedAt }]
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
