/**
 * Spotify catalogue search: the twin of an "Only on YouTube" song (Plan B).
 *
 * Read-only. Results are normalized exactly as playlist rows are, so the
 * matcher reads them without knowing where they came from. See
 * docs/2026-10-08-catalogue-search-design.md §4.
 */

import { normalizePlaylistItem } from '../../model/track.js'

/** Spotify's maximum for a development-mode app since February 2026. */
export const SEARCH_LIMIT = 10

/**
 * @param {{get: Function}} client the Spotify client (src/services/spotify/client.js)
 * @param {string} query Spotify search syntax, e.g. `track:"sheesha" artist:"Karan Aujla"`
 * @returns {Promise<Array<object>>} Tracks, numbered by result position
 */
export async function searchTracks(client, query, limit = SEARCH_LIMIT) {
  const body = await client.get('/search', { query: { q: query, type: 'track', limit } })
  // A null in the items would otherwise be read as an unavailable track.
  return (body?.tracks?.items ?? [])
    .filter(Boolean)
    .map((raw, index) => normalizePlaylistItem({ track: raw }, index))
}

/**
 * One track by id, for pairing by a pasted link. A development-mode app may
 * still read one track; only the batch endpoint went in February 2026.
 */
export async function getTrack(client, id) {
  return normalizePlaylistItem({ track: await client.get(`/tracks/${encodeURIComponent(id)}`) }, 0)
}
