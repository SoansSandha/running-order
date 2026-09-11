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
export function buildRestoreOrder(currentTracks, snapshot) {
  const available = new Map()
  currentTracks.forEach((track, index) => {
    const queue = available.get(track.uri)
    if (queue) queue.push(index)
    else available.set(track.uri, [index])
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
