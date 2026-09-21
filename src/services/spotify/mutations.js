/**
 * Write operations.
 *
 * See docs design §5.4 and §9. Writes are strictly sequential: every reorder
 * returns a new snapshot id that the following call must quote.
 */

import { playlistItemsPath } from './endpoints.js'

const MAX_URIS_PER_REQUEST = 100

/**
 * Move one range of tracks. `insertBefore` is expressed in PRE-removal
 * indexing — see plan/diff.js, which computes it.
 *
 * @returns {Promise<string|null>} the new snapshot id
 */
export async function reorderTrack(client, playlistId, op, snapshotId) {
  const result = await client.put(playlistItemsPath(playlistId), {
    body: {
      range_start: op.rangeStart,
      insert_before: op.insertBefore,
      range_length: op.rangeLength ?? 1,
      snapshot_id: snapshotId,
    },
  })
  return result?.snapshot_id ?? null
}

/**
 * Append URIs in the largest batches the API accepts, preserving order.
 * Used by clone-and-sort, which never needs the move algorithm.
 */
export async function addTracksInChunks(client, playlistId, uris, { onProgress } = {}) {
  for (let start = 0; start < uris.length; start += MAX_URIS_PER_REQUEST) {
    const chunk = uris.slice(start, start + MAX_URIS_PER_REQUEST)
    await client.post(playlistItemsPath(playlistId), { body: { uris: chunk } })
    onProgress?.(Math.min(start + chunk.length, uris.length), uris.length)
  }
}

/**
 * Replace the playlist's entire contents.
 *
 * NOT used for in-place sorting: it resets every added_at to now, which
 * destroys the data the date-added comparator reads (design D4).
 */
export async function replaceTracks(client, playlistId, uris) {
  const head = uris.slice(0, MAX_URIS_PER_REQUEST)
  const result = await client.put(playlistItemsPath(playlistId), { body: { uris: head } })
  if (uris.length > MAX_URIS_PER_REQUEST) {
    await addTracksInChunks(client, playlistId, uris.slice(MAX_URIS_PER_REQUEST))
  }
  return result?.snapshot_id ?? null
}

/** Statuses that mean "wrong door", as opposed to "you may not do this". */
const ENDPOINT_REFUSALS = new Set([403, 404, 405])

/**
 * Create a playlist for the signed-in user.
 *
 * Spotify has moved this surface: `/users/{id}/playlists` answers 403 for
 * this app while the rest of the playlist API has migrated toward `/me`. Both
 * are attempted rather than betting on one, and the request log shows which
 * answered. A failure that is not about the endpoint is not retried.
 */
export async function createPlaylist(client, userId, { name, description = '', isPublic = false }) {
  const body = { name, description, public: isPublic }

  try {
    return await client.post('/me/playlists', { body })
  } catch (failure) {
    if (!ENDPOINT_REFUSALS.has(failure?.status)) throw failure
    return client.post(`/users/${userId}/playlists`, { body })
  }
}
