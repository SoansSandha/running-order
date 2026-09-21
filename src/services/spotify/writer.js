/**
 * Spotify's implementation of the writer contract the planner depends on.
 *
 * The planner (plan/execute.js, plan/clone.js) knows this shape and nothing
 * else about Spotify, so a second service is a second writer rather than a
 * second planner. See docs/2026-09-18-youtube-mirror-design.md §4.
 */

import { addTracksInChunks, createPlaylist, reorderTrack } from './mutations.js'

export function createSpotifyWriter(client) {
  return {
    /** Spotify moves by index; `op`'s neutral fields are ignored here. */
    reorder(playlistId, op, revision) {
      return reorderTrack(client, playlistId, op, revision)
    },

    createPlaylist(ownerId, { name, description = '', isPublic = false }) {
      return createPlaylist(client, ownerId, { name, description, isPublic })
    },

    /**
     * Takes Tracks rather than URIs: a URI is Spotify's identifier, and the
     * planner must not have to know which identifier a service uses.
     */
    addTracks(playlistId, tracks, { onProgress } = {}) {
      return addTracksInChunks(
        client,
        playlistId,
        tracks.map((track) => track.uri),
        { onProgress },
      )
    },
  }
}
