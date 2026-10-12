/**
 * YouTube Music's implementation of the writer contract the planner depends
 * on (mirror run design §8). Each method sends one request; the mirror run
 * decides the batches.
 *
 * Items are addressed by setVideoId, the playlist-item id, so a move plan
 * keyed with `keyOf: (track) => track.itemId` passes straight through:
 * edit_playlist's own form is "move this item before that one" (mirror
 * design §4).
 */

export function createYouTubeWriter(client) {
  return {
    /** YouTube has no snapshot id, so a move takes no revision and returns none. */
    reorder(playlistId, op) {
      return client.moveItem(playlistId, op.key, op.beforeKey)
    },

    /** Answers `[{ videoId, setVideoId }]`, the ids YouTube gave the added items. */
    addTracks(playlistId, tracks) {
      return client.addItems(playlistId, tracks.map((track) => track.id))
    },

    /** `items` are `{ videoId, setVideoId }`, as the undo record holds them. */
    removeTracks(playlistId, items) {
      return client.removeItems(
        playlistId,
        items.map(({ videoId, setVideoId }) => ({ videoId, setVideoId })),
      )
    },
  }
}
