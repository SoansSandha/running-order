/**
 * Test-only fixture builders.
 *
 * Fixtures are built as raw Spotify payloads and passed through the real
 * normalizer, so tests exercise the production mapping rather than a
 * hand-written imitation of it.
 */

import { normalizePlaylistItem } from '../model/track.js'

let counter = 0

export function resetFactory() {
  counter = 0
}

/** Build a raw playlist item. */
export function makeItem({
  id,
  name = 'Track',
  artists = [{ id: 'a1', name: 'Artist' }],
  album = 'Album',
  albumId,
  releaseDate = '2000-01-01',
  releaseDatePrecision,
  addedAt = '2020-01-01T00:00:00Z',
  durationMs = 200000,
  popularity = 50,
  explicit = false,
  trackNumber = 1,
  discNumber = 1,
  isrc = null,
  isLocal = false,
} = {}) {
  const key = id ?? `t${++counter}`
  return {
    added_at: addedAt,
    is_local: isLocal,
    track: {
      id: key,
      uri: `spotify:track:${key}`,
      name,
      type: 'track',
      duration_ms: durationMs,
      popularity,
      explicit,
      track_number: trackNumber,
      disc_number: discNumber,
      external_ids: isrc ? { isrc } : {},
      artists,
      album: {
        id: albumId ?? `al-${album}`,
        name: album,
        release_date: releaseDate,
        release_date_precision:
          releaseDatePrecision ?? precisionOf(releaseDate),
      },
    },
  }
}

/** Build a normalized Track directly. */
export function makeTrack(overrides = {}, index = 0) {
  return normalizePlaylistItem(makeItem(overrides), index)
}

/** Build a list of normalized Tracks, numbered by position. */
export function makeTracks(overridesList) {
  return overridesList.map((overrides, index) => makeTrack(overrides, index))
}

/** A track Spotify no longer serves: occupies a position, carries no data. */
export function makeUnavailable(index = 0, addedAt = '2020-01-01T00:00:00Z') {
  return normalizePlaylistItem({ added_at: addedAt, track: null }, index)
}

/** A podcast episode: credits no artists, belongs to a show. */
export function makeEpisode({ name = 'Episode', show = 'Show', addedAt = '2022-01-01T00:00:00Z', durationMs = 1800000 } = {}, index = 0) {
  const key = `e${++counter}`
  return normalizePlaylistItem(
    {
      added_at: addedAt,
      track: {
        id: key,
        uri: `spotify:episode:${key}`,
        name,
        type: 'episode',
        duration_ms: durationMs,
        show: { id: `sh-${show}`, name: show },
      },
    },
    index,
  )
}

function precisionOf(date) {
  if (!date) return null
  const segments = String(date).split('-').length
  return segments === 1 ? 'year' : segments === 2 ? 'month' : 'day'
}
