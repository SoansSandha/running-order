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

/**
 * Where a no-match mark on this song is filed (no-match design §3): under its
 * own key, with the other side null. Null for a song with no key (M-3).
 */
export function markKeysOf(song) {
  if (song?.source === 'youtube') return song.id == null ? null : { spotifyKey: null, youtubeVideoId: song.id }
  const key = spotifyKeyOf(song)
  return key == null ? null : { spotifyKey: key, youtubeVideoId: null }
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
 * The book once the owner picks another track for a proposal (match tray
 * design §3): `different` for the proposal, then `same` for the pick. A pick
 * in neither playlist leaves settlePairs claiming the proposal unless it is
 * rejected. A pick of the proposal's own track overwrites the `different`.
 */
export function replaceProposal(book, proposal, pick, decidedAt = Date.now()) {
  const rejected = recordDecision(book, { ...proposal, verdict: 'different' }, decidedAt)
  return recordDecision(rejected, { ...pick, verdict: 'same' }, decidedAt)
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

/**
 * The snapshot a confirmed pair keeps (D29): of its YouTube track when that
 * track is not in the YouTube playlist, else of its Spotify track when that is
 * not in the Spotify playlist; none for a pair from the two playlists.
 */
export function findSnapshotFor(spotifyTrack, youtubeTrack, { youtubeIds, spotifyKeys }) {
  if (!youtubeIds.has(youtubeTrack?.id)) return snapshotOf(youtubeTrack, 'youtube')
  if (!spotifyKeys.has(spotifyKeyOf(spotifyTrack))) return snapshotOf(spotifyTrack, 'spotify')
  return undefined
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
  // A no-match mark is about one song, not a pair, so pairing never sees it.
  const pairs = book.filter((entry) => entry.verdict !== 'none')
  const verdicts = new Map(pairs.map((entry) => [pairKey(entry.spotifyKey, entry.youtubeVideoId), entry.verdict]))
  return (spotifyKey, youtubeVideoId) => verdicts.get(pairKey(spotifyKey, youtubeVideoId)) ?? null
}

function pairKey(spotifyKey, youtubeVideoId) {
  return `${spotifyKey}\u0000${youtubeVideoId}`
}

function isDecision(entry) {
  const spotify = typeof entry?.spotifyKey === 'string'
  const youtube = typeof entry?.youtubeVideoId === 'string'
  // No-match design §3: a mark names one song, so exactly one side, the other null.
  if (entry?.verdict === 'none') return spotify ? entry.youtubeVideoId === null : youtube && entry.spotifyKey === null
  return spotify && youtube && VERDICTS.has(entry?.verdict)
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
