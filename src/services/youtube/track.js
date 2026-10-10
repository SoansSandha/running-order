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
    tracks.push(toTrack(raw, tracks.length, raw.setVideoId))
  }
  return tracks
}

/**
 * Catalogue search results (Plan B), as Tracks. A result is not a playlist
 * row: it has no setVideoId, so its itemId is null. One with no videoId can be
 * neither played nor paired, and is dropped.
 *
 * @param {Array<object>} rawResults ytmusicapi's search result dicts
 */
export function normalizeYouTubeSearchResults(rawResults) {
  const tracks = []
  for (const raw of rawResults ?? []) {
    if (!raw?.videoId) continue
    tracks.push(toTrack(raw, tracks.length, null))
  }
  return tracks
}

function toTrack(raw, originalIndex, itemId) {
  const artists = (raw.artists ?? []).map((artist) => ({
    id: artist?.id ?? null,
    name: artist?.name ?? '',
  }))
  const primaryArtist = artists[0] ?? null

  const album = raw.album
    ? { id: raw.album.id ?? null, name: raw.album.name ?? '', releaseDate: null, releaseDatePrecision: null }
    : EMPTY_ALBUM

  return {
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
    originalIndex,

    source: 'youtube',
    itemId,
    // ATV is an album audio track, OMV an official music video, UGC a user
    // upload. The matcher uses it only to break a tie (M3).
    videoType: raw.videoType ?? null,

    isLocal: false,
    isUnavailable: raw.isAvailable === false,
    isEpisode: false,
  }
}
