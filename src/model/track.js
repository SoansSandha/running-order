/**
 * Normalizes raw Spotify playlist items into the flat Track shape the sort,
 * csv, and plan layers consume.
 *
 * Pure module: no network, no browser APIs. See docs design §5.2.
 *
 * Every field any comparator might want is resolved here, once, so no sort
 * strategy ever needs a second round trip.
 */

import { padReleaseDate, sortKey } from './normalize.js'

const EMPTY_ALBUM = Object.freeze({
  id: null,
  name: '',
  releaseDate: null,
  releaseDatePrecision: null,
})

/**
 * @param {object} item  a raw item from GET /playlists/{id}/tracks
 * @param {number} index the item's position in the fetched playlist
 */
export function normalizePlaylistItem(item, index) {
  const raw = item?.track ?? null
  const isUnavailable = raw === null
  const isEpisode = raw?.type === 'episode'

  const artists = (raw?.artists ?? []).map((artist) => ({
    id: artist.id ?? null,
    name: artist.name ?? '',
  }))
  const primaryArtist = artists[0] ?? null
  const showName = raw?.show?.name ?? null

  // Episodes credit no artists, so they group under their show instead.
  const groupingName = isEpisode ? showName : primaryArtist?.name
  const groupingId = isEpisode ? null : primaryArtist?.id

  const album = raw?.album
    ? {
        id: raw.album.id ?? null,
        name: raw.album.name ?? '',
        releaseDate: raw.album.release_date ?? null,
        releaseDatePrecision: raw.album.release_date_precision ?? null,
      }
    : EMPTY_ALBUM

  return {
    id: raw?.id ?? null,
    uri: raw?.uri ?? null,
    name: raw?.name ?? '',

    artists,
    primaryArtist,
    // Identity for bucketing prefers the artist id, so spelling variants of a
    // name cannot split one artist into two blocks. Local files and episodes
    // have no id, so they fall back to the folded name.
    artistGroupKey: groupingId ?? sortKey(groupingName),
    artistSortKey: sortKey(groupingName),
    showName,

    album,
    releaseDateSortable: padReleaseDate(album.releaseDate, album.releaseDatePrecision),

    durationMs: raw?.duration_ms ?? 0,
    popularity: raw?.popularity ?? 0,
    explicit: raw?.explicit ?? false,
    trackNumber: raw?.track_number ?? 0,
    discNumber: raw?.disc_number ?? 0,
    isrc: raw?.external_ids?.isrc ?? null,

    addedAt: item?.added_at ?? null,
    originalIndex: index,

    isLocal: item?.is_local === true,
    isUnavailable,
    isEpisode,
  }
}

/** Normalize a whole fetched page set, numbering by fetch position. */
export function normalizePlaylistItems(items) {
  return items.map((item, index) => normalizePlaylistItem(item, index))
}
