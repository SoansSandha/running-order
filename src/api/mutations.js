/**
 * Write operations.
 *
 * See docs design §5.4 and §9. Writes are strictly sequential: every reorder
 * returns a new snapshot id that the following call must quote.
 */

const MAX_URIS_PER_REQUEST = 100

/**
 * Move one range of tracks. `insertBefore` is expressed in PRE-removal
 * indexing — see plan/diff.js, which computes it.
 *
 * @returns {Promise<string|null>} the new snapshot id
 */
export async function reorderTrack(client, playlistId, op, snapshotId) {
  const result = await client.put(`/playlists/${playlistId}/tracks`, {
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
    await client.post(`/playlists/${playlistId}/tracks`, { body: { uris: chunk } })
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
  const result = await client.put(`/playlists/${playlistId}/tracks`, { body: { uris: head } })
  if (uris.length > MAX_URIS_PER_REQUEST) {
    await addTracksInChunks(client, playlistId, uris.slice(MAX_URIS_PER_REQUEST))
  }
  return result?.snapshot_id ?? null
}

export async function createPlaylist(client, userId, { name, description = '', isPublic = false }) {
  return client.post(`/users/${userId}/playlists`, {
    body: { name, description, public: isPublic },
  })
}
