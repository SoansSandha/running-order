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
 * The URL of the largest thumbnail by width, or null when there are none.
 *
 * ytmusicapi lists thumbnails smallest-first, but that ordering is not
 * contracted, so the widest is picked explicitly rather than assumed to be
 * last. Largest because the row art should not be upscaled from a small one.
 *
 * @param {Array<{url: string, width: number, height: number}>|undefined} thumbnails
 * @returns {string|null}
 */
function largestThumbnailUrl(thumbnails) {
  if (!thumbnails || thumbnails.length === 0) return null
  return thumbnails.reduce((largest, current) =>
    current.width > largest.width ? current : largest,
  ).url
}

/**
 * @param {Array<{id: string, title: string, count: number|null, description?: string|null, thumbnails?: Array}>} rawPlaylists
 * @returns {Array<object>} playlists in the app's shared shape
 */
export function toAppPlaylists(rawPlaylists) {
  return (rawPlaylists ?? [])
    .filter((raw) => raw?.id && !SYSTEM_PLAYLIST_IDS.has(raw.id))
    .map((raw) => ({
      id: raw.id,
      name: raw.title ?? '',
      // Matches Spotify's adapter (src/services/spotify/playlists.js), which
      // also falls back to '' for a missing description.
      description: raw.description ?? '',
      imageUrl: largestThumbnailUrl(raw.thumbnails),
      trackCount: raw.count ?? 0,
      // The screen reads owner.displayName unguarded. YouTube's listing names
      // no owner, and everything it returns is the signed-in user's own.
      owner: { id: null, displayName: 'YouTube Music' },
      isPublic: false,
      // No snapshot id exists; the pre-write guard re-fetches and compares
      // contents instead. See spec §11.
      snapshotId: null,
      // There is no YouTube writer, so nothing here can be reordered in
      // place OR cloned. Claiming otherwise lit "Apply order" and painted
      // "Access: EDITABLE", both of which aimed Spotify writes at a YouTube
      // id. capabilities.writeUnsupportedReason is what gates the levers and
      // supplies the reason; this flag stays honest so no screen reading it
      // on its own is misled either.
      editable: false,
      source: 'youtube',
    }))
}
