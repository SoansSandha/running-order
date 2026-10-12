/**
 * Undo snapshots: capture a playlist's order before a write, and rebuild it
 * afterwards.
 *
 * Pure module: no network. Storage is injected so it can be tested without a
 * browser. See docs design §9.1.
 */

const KEY_PREFIX = 'playlist-sorter:undo:'
const SNAPSHOT_VERSION = 1

/**
 * @param {{id: string, name: string, snapshotId: string|null}} playlist
 * @param {Array} tracks normalized Tracks in current order
 */
export function createSnapshot(playlist, tracks) {
  return {
    version: SNAPSHOT_VERSION,
    playlistId: playlist.id,
    playlistName: playlist.name,
    snapshotId: playlist.snapshotId ?? null,
    trackCount: tracks.length,
    // URIs rather than positions: after a reorder the positions mean nothing,
    // but the URIs still identify the tracks.
    uris: tracks.map((track) => track.uri),
    createdAt: Date.now(),
  }
}

/**
 * The order that puts the playlist back the way the snapshot found it.
 *
 * Tolerates drift in both directions: tracks added since the snapshot fall to
 * the bottom, and snapshot entries whose track has since been removed are
 * skipped. The result is always a permutation of what the playlist holds now,
 * never of what it held then.
 */
export function buildRestoreOrder(currentTracks, snapshot, keyOf = (track) => track.uri) {
  // The mirror run restores YouTube by videoId (mirror run design §6), giving
  // its record's `orderBefore` as `snapshot.uris`.
  const available = new Map()
  currentTracks.forEach((track, index) => {
    const key = keyOf(track)
    const queue = available.get(key)
    if (queue) queue.push(index)
    else available.set(key, [index])
  })

  const restored = []
  const placed = new Set()

  for (const uri of snapshot.uris ?? []) {
    const queue = available.get(uri)
    if (!queue?.length) continue // that track is gone from the playlist
    const index = queue.shift()
    placed.add(index)
    restored.push(currentTracks[index])
  }

  const added = currentTracks.filter((_, index) => !placed.has(index))
  return [...restored, ...added]
}

export function saveSnapshot(snapshot, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY_PREFIX + snapshot.playlistId, JSON.stringify(snapshot))
  } catch {
    // Private browsing and blocked site data both throw here. An undo
    // snapshot is a convenience; losing it must not break the sort.
  }
}

export function loadSnapshot(playlistId, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(KEY_PREFIX + playlistId)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearSnapshot(playlistId, storage = globalThis.localStorage) {
  try {
    storage?.removeItem(KEY_PREFIX + playlistId)
  } catch {
    // See saveSnapshot.
  }
}

/** The snapshot as a downloadable file, for undo that outlives the browser. */
export function serializeSnapshot(snapshot) {
  return JSON.stringify(snapshot, null, 2)
}

const MIRROR_PREFIX = 'playlist-sorter:mirror-undo:'
const MIRROR_VERSION = 1

/**
 * The undo record a mirror run writes against (mirror run design §6). An
 * unfinished record for the same two playlists carries forward, so Undo after
 * stopping and running again reaches back to before the first attempt (D54).
 * Anything else starts afresh from YouTube's order now.
 */
export function startMirrorRecord(prior, { youtubePlaylistId, spotifyPlaylistId, youtubeTracks }, now = Date.now()) {
  if (
    prior &&
    !prior.finished &&
    prior.youtubePlaylistId === youtubePlaylistId &&
    prior.spotifyPlaylistId === spotifyPlaylistId
  ) {
    return prior
  }
  return {
    version: MIRROR_VERSION,
    youtubePlaylistId,
    spotifyPlaylistId,
    orderBefore: youtubeTracks.map((track) => track.id),
    addedToYoutube: [],
    addedToSpotify: [],
    // Set once the run starts reordering; Undo restores the order only then.
    reordered: false,
    finished: false,
    createdAt: now,
  }
}

/** False when the browser refuses; the record then lives only in memory (§6). */
export function saveMirrorRecord(record, storage = globalThis.localStorage) {
  try {
    storage.setItem(MIRROR_PREFIX + record.youtubePlaylistId, JSON.stringify(record))
    return true
  } catch {
    return false
  }
}

export function loadMirrorRecord(youtubePlaylistId, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(MIRROR_PREFIX + youtubePlaylistId)
    const record = raw ? JSON.parse(raw) : null
    return record?.version === MIRROR_VERSION ? record : null
  } catch {
    return null
  }
}

export function clearMirrorRecord(youtubePlaylistId, storage = globalThis.localStorage) {
  try {
    storage?.removeItem(MIRROR_PREFIX + youtubePlaylistId)
  } catch {
    // See saveSnapshot.
  }
}
