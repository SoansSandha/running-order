/**
 * Adapts the proxy's playlist list to the shape the UI already renders for
 * Spotify, so the playlists screen needs no knowledge of which service a row
 * came from.
 *
 * Pure module: no network. The client fetches; this maps.
 */

/**
 * YouTube's own lists. `LM` is Liked Music and `SE` is Episodes for Later —
 * neither is a real playlist and neither can be reordered, so they are left
 * out rather than shown as something the app cannot act on.
 */
const SYSTEM_PLAYLIST_IDS = new Set(['LM', 'SE'])

/**
 * @param {Array<{id: string, title: string, count: number|null}>} rawPlaylists
 * @returns {Array<object>} playlists in the app's shared shape
 */
export function toAppPlaylists(rawPlaylists) {
  return (rawPlaylists ?? [])
    .filter((raw) => raw?.id && !SYSTEM_PLAYLIST_IDS.has(raw.id))
    .map((raw) => ({
      id: raw.id,
      name: raw.title ?? '',
      trackCount: raw.count ?? 0,
      // The screen reads owner.displayName unguarded. YouTube's listing names
      // no owner, and everything it returns is the signed-in user's own.
      owner: { id: null, displayName: 'YouTube Music' },
      isPublic: false,
      // No snapshot id exists; the pre-write guard re-fetches and compares
      // contents instead. See spec §11.
      snapshotId: null,
      editable: true,
      source: 'youtube',
    }))
}
