import { describe, expect, test } from 'vitest'
import { normalizePlaylistItem, normalizePlaylistItems } from './track.js'

const fullItem = {
  added_at: '2021-03-04T12:00:00Z',
  is_local: false,
  track: {
    id: 't1',
    uri: 'spotify:track:t1',
    name: 'Something',
    type: 'track',
    duration_ms: 182000,
    popularity: 71,
    explicit: false,
    track_number: 2,
    disc_number: 1,
    external_ids: { isrc: 'GBAYE0601477' },
    artists: [
      { id: 'a1', name: 'The Beatles' },
      { id: 'a2', name: 'Billy Preston' },
    ],
    album: {
      id: 'al1',
      name: 'Abbey Road',
      release_date: '1969-09-26',
      release_date_precision: 'day',
    },
  },
}

describe('normalizePlaylistItem — ordinary track', () => {
  const track = normalizePlaylistItem(fullItem, 7)

  test('carries the identifiers writes depend on', () => {
    expect(track.id).toBe('t1')
    expect(track.uri).toBe('spotify:track:t1')
  })

  test('carries every field a comparator may need, so no second fetch is required', () => {
    expect(track.name).toBe('Something')
    expect(track.durationMs).toBe(182000)
    expect(track.popularity).toBe(71)
    expect(track.explicit).toBe(false)
    expect(track.trackNumber).toBe(2)
    expect(track.discNumber).toBe(1)
    expect(track.isrc).toBe('GBAYE0601477')
    expect(track.addedAt).toBe('2021-03-04T12:00:00Z')
  })

  test('records the position it was fetched at, for stable tiebreaking', () => {
    expect(track.originalIndex).toBe(7)
  })

  test('treats the first credited artist as primary', () => {
    expect(track.primaryArtist).toEqual({ id: 'a1', name: 'The Beatles' })
    expect(track.artists).toHaveLength(2)
  })

  test('derives an alphabetical key that ignores the leading article', () => {
    expect(track.artistSortKey).toBe('beatles')
  })

  test('groups by artist id, not name, so spelling variants cannot split a block', () => {
    expect(track.artistGroupKey).toBe('a1')
  })

  test('pads the release date so mixed-precision dates compare as strings', () => {
    expect(track.releaseDateSortable).toBe('1969-09-26')
    expect(track.album.name).toBe('Abbey Road')
  })

  test('is flagged as an ordinary, available, non-local track', () => {
    expect(track.isUnavailable).toBe(false)
    expect(track.isLocal).toBe(false)
    expect(track.isEpisode).toBe(false)
  })
})

describe('normalizePlaylistItem — unavailable track', () => {
  const track = normalizePlaylistItem({ added_at: '2020-01-01T00:00:00Z', track: null }, 3)

  test('is flagged unavailable rather than dropped, because it occupies a position', () => {
    expect(track.isUnavailable).toBe(true)
    expect(track.originalIndex).toBe(3)
  })

  test('has no URI, which is what makes it uncloneable', () => {
    expect(track.uri).toBe(null)
  })

  test('yields empty sort keys instead of throwing', () => {
    expect(track.artistSortKey).toBe('')
    expect(track.releaseDateSortable).toBe('')
    expect(track.artists).toEqual([])
  })
})

describe('normalizePlaylistItem — local file', () => {
  const track = normalizePlaylistItem(
    {
      added_at: '2019-05-05T00:00:00Z',
      is_local: true,
      track: {
        id: null,
        uri: 'spotify:local:Nirvana:Bleach:Blew:193',
        name: 'Blew',
        type: 'track',
        duration_ms: 193000,
        artists: [{ id: null, name: 'Nirvana' }],
        album: { id: null, name: 'Bleach', release_date: null },
      },
    },
    0,
  )

  test('is flagged local, because it can be reordered but never cloned', () => {
    expect(track.isLocal).toBe(true)
    expect(track.isUnavailable).toBe(false)
  })

  test('falls back to the normalized artist name when there is no artist id', () => {
    expect(track.artistGroupKey).toBe('nirvana')
    expect(track.artistSortKey).toBe('nirvana')
  })
})

describe('normalizePlaylistItem — podcast episode', () => {
  const track = normalizePlaylistItem(
    {
      added_at: '2022-07-07T00:00:00Z',
      track: {
        id: 'e1',
        uri: 'spotify:episode:e1',
        name: 'Episode 12',
        type: 'episode',
        duration_ms: 2400000,
        show: { id: 's1', name: 'Reply All' },
      },
    },
    1,
  )

  test('is flagged as an episode so it can be grouped separately', () => {
    expect(track.isEpisode).toBe(true)
  })

  test('groups under its show, since an episode credits no artists', () => {
    expect(track.showName).toBe('Reply All')
    expect(track.artists).toEqual([])
    expect(track.artistGroupKey).toBe('reply all')
  })
})

describe('normalizePlaylistItems', () => {
  test('numbers tracks by fetch position so original order is always recoverable', () => {
    const tracks = normalizePlaylistItems([fullItem, { track: null }, fullItem])
    expect(tracks.map((t) => t.originalIndex)).toEqual([0, 1, 2])
  })
})
