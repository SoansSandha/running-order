/**
 * The artist-grouped sort: artists A→Z, one contiguous block each, with a
 * choice of ordering inside the block.
 *
 * Pure module: no network, no browser APIs. See docs design §6.1.
 *
 * A track files under its PRIMARY artist only. A collaboration sits in one
 * block, never two — a reorder is a permutation, so a track cannot occupy two
 * positions, and the track count is invariant by construction.
 */

import {
  byAddedAt,
  byAlbumThenTrack,
  byOriginalIndex,
  byReleaseDate,
  byTitle,
  chain,
  compareText,
} from './comparators.js'

export const INNER_ORDERS = {
  addedAt: byAddedAt,
  releaseDate: byReleaseDate,
  album: byAlbumThenTrack,
  title: byTitle,
}

export const DEFAULT_INNER_ORDER = 'addedAt'

/**
 * @param {Array} tracks normalized Tracks
 * @param {{innerOrder?: keyof INNER_ORDERS}} options
 */
export function artistGrouped(tracks, { innerOrder = DEFAULT_INNER_ORDER } = {}) {
  const within = chain(
    INNER_ORDERS[innerOrder] ?? INNER_ORDERS[DEFAULT_INNER_ORDER],
    byAlbumThenTrack,
    byOriginalIndex,
  )

  const artists = []
  const episodes = []
  const unavailable = []

  for (const track of tracks) {
    if (track.isUnavailable) unavailable.push(track)
    else if (track.isEpisode) episodes.push(track)
    else artists.push(track)
  }

  return [
    ...groupIntoBlocks(artists, within),
    // Episodes credit no artists, so they trail the artist blocks, grouped by show.
    ...groupIntoBlocks(episodes, within),
    // Unavailable tracks carry no sortable data at all. They keep their
    // original relative order at the very bottom.
    ...[...unavailable].sort(byOriginalIndex),
  ]
}

/** Bucket by artist identity, order within each bucket, then order the buckets. */
function groupIntoBlocks(tracks, within) {
  const blocks = new Map()

  for (const track of tracks) {
    let block = blocks.get(track.artistGroupKey)
    if (!block) {
      block = { sortKey: track.artistSortKey, tracks: [] }
      blocks.set(track.artistGroupKey, block)
    }
    block.tracks.push(track)
  }

  return [...blocks.entries()]
    .sort(([keyA, a], [keyB, b]) => compareText(a.sortKey, b.sortKey) || compareText(keyA, keyB))
    .flatMap(([, block]) => block.tracks.sort(within))
}
