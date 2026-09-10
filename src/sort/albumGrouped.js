/**
 * The album-grouped sort: one contiguous block per album, each read in the
 * order it was meant to be heard.
 *
 * Pure module: no network, no browser APIs. See docs design §6.
 */

import { sortKey } from '../model/normalize.js'
import { byOriginalIndex, byTrackNumber, chain, compareText } from './comparators.js'

export const ALBUM_ORDERS = { releaseDate: 'releaseDate', name: 'name' }
export const DEFAULT_ALBUM_ORDER = 'releaseDate'

export function albumGrouped(tracks, { albumOrder = DEFAULT_ALBUM_ORDER } = {}) {
  const within = chain(byTrackNumber, byOriginalIndex)

  const albums = []
  const episodes = []
  for (const track of tracks) {
    if (track.isEpisode) episodes.push(track)
    else albums.push(track)
  }

  const blocks = new Map()
  for (const track of albums) {
    const key = track.album?.id ?? sortKey(track.album?.name)
    let block = blocks.get(key)
    if (!block) {
      block = { name: track.album?.name ?? '', releaseDate: track.releaseDateSortable, tracks: [] }
      blocks.set(key, block)
    }
    // An album's date is the earliest its tracks report, so a compilation
    // credited across years still lands somewhere stable.
    if (track.releaseDateSortable && track.releaseDateSortable < block.releaseDate) {
      block.releaseDate = track.releaseDateSortable
    }
    block.tracks.push(track)
  }

  const ordered = [...blocks.entries()].sort(([keyA, a], [keyB, b]) => {
    const primary =
      albumOrder === ALBUM_ORDERS.name
        ? compareText(a.name, b.name)
        : compareText(a.releaseDate, b.releaseDate) || compareText(a.name, b.name)
    return primary || compareText(keyA, keyB)
  })

  return [
    ...ordered.flatMap(([, block]) => block.tracks.sort(within)),
    // Episodes belong to no album, so they trail the album blocks.
    ...episodes.sort(chain((a, b) => compareText(a.showName, b.showName), byOriginalIndex)),
  ]
}
