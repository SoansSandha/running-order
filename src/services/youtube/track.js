/**
 * Normalizes YouTube Music tracks into the same flat Track shape
 * src/model/track.js produces for Spotify, so sort/, csv/ and plan/ consume
 * both without knowing which service a Track came from.
 *
 * Pure module: no network, no browser APIs.
 *
 * What YouTube Music does not return — date added, track number, release
 * year, ISRC — is left empty rather than invented. Spec §1 records which
 * sorts that costs.
 */

import { sortKey } from '../../model/normalize.js'

const EMPTY_ALBUM = Object.freeze({
  id: null,
  name: '',
  releaseDate: null,
  releaseDatePrecision: null,
})

/**
 * @param {Array<object>} rawTracks ytmusicapi's track dicts, in playlist order
 * @returns {Array<object>} Tracks, renumbered by accepted position
 */
export function normalizeYouTubeTracks(rawTracks) {
  const tracks = []
  for (const raw of rawTracks ?? []) {
    // A row with no setVideoId cannot be addressed by a reorder, and null is
    // the beforeKey end-of-list sentinel — keying on it would corrupt a plan.
    if (!raw?.setVideoId) continue

    const artists = (raw.artists ?? []).map((artist) => ({
      id: artist?.id ?? null,
      name: artist?.name ?? '',
    }))
    const primaryArtist = artists[0] ?? null

    const album = raw.album
      ? { id: raw.album.id ?? null, name: raw.album.name ?? '', releaseDate: null, releaseDatePrecision: null }
      : EMPTY_ALBUM

    tracks.push({
      id: raw.videoId ?? null,
      // YouTube has no playable URI of Spotify's kind. The Spotify writer's
      // canWrite() reads this, which is why a YouTube Track must not fake one.
      uri: null,
      name: raw.title ?? '',

      artists,
      primaryArtist,
      artistGroupKey: primaryArtist?.id ?? sortKey(primaryArtist?.name),
      artistSortKey: sortKey(primaryArtist?.name),
      showName: null,

      album,
      // No release date is returned at any level, so no album sorts by date.
      releaseDateSortable: null,

      durationMs: (raw.duration_seconds ?? 0) * 1000,
      popularity: 0,
      explicit: raw.isExplicit === true,
      trackNumber: 0,
      discNumber: 0,
      isrc: null,

      addedAt: null,
      originalIndex: tracks.length,

      source: 'youtube',
      itemId: raw.setVideoId,

      isLocal: false,
      isUnavailable: raw.isAvailable === false,
      isEpisode: false,
    })
  }
  return tracks
}
