/**
 * Endpoint paths that Spotify has moved.
 *
 * The playlist contents endpoint is `/playlists/{id}/items`. The older
 * `/tracks` path answers 403 for this app, and the playlist object itself
 * advertises the `items` href — so this is a migration, not a permissions
 * problem. Kept in one place because reads and writes both target it, and
 * because a path Spotify has moved once can move again.
 */

export function playlistItemsPath(playlistId) {
  return `/playlists/${playlistId}/items`
}

/**
 * How many tracks a playlist holds.
 *
 * The live API returns this as `items.total`; older payloads used
 * `tracks.total`. Reading only one of them silently reports every playlist as
 * empty, which is exactly what happened.
 */
export function playlistTrackCount(playlist) {
  return playlist?.items?.total ?? playlist?.tracks?.total ?? 0
}
