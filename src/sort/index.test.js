import { describe, expect, test } from 'vitest'
import { makeEpisode, makeTrack, makeTracks, makeUnavailable } from '../test/factory.js'
import { STRATEGIES, sortTracks, strategyById } from './index.js'

const names = (tracks) => tracks.map((t) => t.name)
const artist = (id, name) => [{ id, name }]

describe('strategy registry', () => {
  test('exposes every strategy the UI offers', () => {
    expect(STRATEGIES.map((s) => s.id)).toEqual([
      'artist',
      'album',
      'releaseDate',
      'addedAt',
      'title',
      'duration',
      'popularity',
      'shuffle',
      'reverse',
    ])
  })

  test('gives every strategy a label and a description for the picker', () => {
    for (const strategy of STRATEGIES) {
      expect(strategy.label, strategy.id).toBeTruthy()
      expect(strategy.description, strategy.id).toBeTruthy()
    }
  })

  test('declares no audio-feature strategies, which Spotify no longer serves', () => {
    const ids = STRATEGIES.map((s) => s.id)
    expect(ids).not.toContain('tempo')
    expect(ids).not.toContain('energy')
  })

  test('looks a strategy up by id', () => {
    expect(strategyById('artist').label).toBe('Artist')
  })

  test('rejects an unknown strategy rather than silently doing nothing', () => {
    expect(() => sortTracks([], { strategy: 'bogus' })).toThrow(/unknown strategy/i)
  })
})

describe('flat strategies', () => {
  const mixed = () =>
    makeTracks([
      { name: 'beta', addedAt: '2022-01-01T00:00:00Z', releaseDate: '2001-01-01', durationMs: 300000, popularity: 20 },
      { name: 'alpha', addedAt: '2024-01-01T00:00:00Z', releaseDate: '1995-01-01', durationMs: 100000, popularity: 80 },
      { name: 'gamma', addedAt: '2018-01-01T00:00:00Z', releaseDate: '2010-01-01', durationMs: 200000, popularity: 50 },
    ])

  test('title sorts A to Z', () => {
    expect(names(sortTracks(mixed(), { strategy: 'title' }))).toEqual(['alpha', 'beta', 'gamma'])
  })

  test('release date sorts oldest first', () => {
    expect(names(sortTracks(mixed(), { strategy: 'releaseDate' }))).toEqual(['alpha', 'beta', 'gamma'])
  })

  test('date added sorts oldest first', () => {
    expect(names(sortTracks(mixed(), { strategy: 'addedAt' }))).toEqual(['gamma', 'beta', 'alpha'])
  })

  test('duration sorts shortest first', () => {
    expect(names(sortTracks(mixed(), { strategy: 'duration' }))).toEqual(['alpha', 'gamma', 'beta'])
  })

  test('popularity sorts most popular first by default', () => {
    expect(names(sortTracks(mixed(), { strategy: 'popularity' }))).toEqual(['alpha', 'gamma', 'beta'])
  })

  test('direction desc inverts a strategy', () => {
    expect(names(sortTracks(mixed(), { strategy: 'title', direction: 'desc' })))
      .toEqual(['gamma', 'beta', 'alpha'])
  })

  test('popularity desc default inverts to least popular first when asked', () => {
    expect(names(sortTracks(mixed(), { strategy: 'popularity', direction: 'asc' })))
      .toEqual(['beta', 'gamma', 'alpha'])
  })
})

describe('reverse', () => {
  test('inverts the current playlist order literally', () => {
    const tracks = makeTracks([{ name: 'a' }, { name: 'b' }, { name: 'c' }])
    expect(names(sortTracks(tracks, { strategy: 'reverse' }))).toEqual(['c', 'b', 'a'])
  })

  test('reverses unavailable tracks along with everything else', () => {
    // Reverse means reverse. Pinning anything would make it a different sort.
    const tracks = [makeUnavailable(0), makeTrack({ name: 'a' }, 1)]
    expect(sortTracks(tracks, { strategy: 'reverse' }).map((t) => t.originalIndex)).toEqual([1, 0])
  })
})

describe('album strategy', () => {
  const albums = () =>
    makeTracks([
      { name: 'alpha-2', album: 'Alpha', releaseDate: '2020-01-01', trackNumber: 2 },
      { name: 'zed-1', album: 'Zed', releaseDate: '1990-01-01', trackNumber: 1 },
      { name: 'alpha-1', album: 'Alpha', releaseDate: '2020-01-01', trackNumber: 1 },
      { name: 'zed-2', album: 'Zed', releaseDate: '1990-01-01', trackNumber: 2 },
    ])

  test('orders albums by release date by default, reading each in track order', () => {
    expect(names(sortTracks(albums(), { strategy: 'album' })))
      .toEqual(['zed-1', 'zed-2', 'alpha-1', 'alpha-2'])
  })

  test('orders albums alphabetically when asked', () => {
    expect(names(sortTracks(albums(), { strategy: 'album', albumOrder: 'name' })))
      .toEqual(['alpha-1', 'alpha-2', 'zed-1', 'zed-2'])
  })

  test('respects disc number before track number', () => {
    const tracks = makeTracks([
      { name: 'd2t1', album: 'A', discNumber: 2, trackNumber: 1 },
      { name: 'd1t9', album: 'A', discNumber: 1, trackNumber: 9 },
    ])
    expect(names(sortTracks(tracks, { strategy: 'album' }))).toEqual(['d1t9', 'd2t1'])
  })
})

describe('artist strategy', () => {
  test('delegates to the grouped sort with date added as the default inner order', () => {
    const tracks = makeTracks([
      { name: 'b-new', artists: artist('b', 'B'), addedAt: '2024-01-01T00:00:00Z' },
      { name: 'a-only', artists: artist('a', 'A') },
      { name: 'b-old', artists: artist('b', 'B'), addedAt: '2010-01-01T00:00:00Z' },
    ])
    expect(names(sortTracks(tracks, { strategy: 'artist' }))).toEqual(['a-only', 'b-old', 'b-new'])
  })

  test('passes the inner order through', () => {
    const tracks = makeTracks([
      { name: 'later-release', artists: artist('b', 'B'), addedAt: '2010-01-01T00:00:00Z', releaseDate: '2020-01-01' },
      { name: 'early-release', artists: artist('b', 'B'), addedAt: '2024-01-01T00:00:00Z', releaseDate: '1990-01-01' },
    ])
    expect(names(sortTracks(tracks, { strategy: 'artist', innerOrder: 'releaseDate' })))
      .toEqual(['early-release', 'later-release'])
  })
})

describe('shuffle', () => {
  const many = () => makeTracks(Array.from({ length: 30 }, (_, i) => ({ name: `t${i}` })))

  test('is reproducible: the same seed gives the same order', () => {
    expect(names(sortTracks(many(), { strategy: 'shuffle', seed: 'party' })))
      .toEqual(names(sortTracks(many(), { strategy: 'shuffle', seed: 'party' })))
  })

  test('a different seed gives a different order', () => {
    expect(names(sortTracks(many(), { strategy: 'shuffle', seed: 'party' })))
      .not.toEqual(names(sortTracks(many(), { strategy: 'shuffle', seed: 'quiet' })))
  })

  test('actually reorders rather than returning the input untouched', () => {
    const tracks = many()
    expect(names(sortTracks(tracks, { strategy: 'shuffle', seed: 'x' }))).not.toEqual(names(tracks))
  })
})

describe('unavailable tracks', () => {
  test('sink to the bottom of every sorting strategy', () => {
    for (const strategy of STRATEGIES.filter((s) => s.id !== 'reverse')) {
      const tracks = [
        makeUnavailable(0),
        makeTrack({ name: 'real', artists: artist('a', 'A') }, 1),
      ]
      const sorted = sortTracks(tracks, { strategy: strategy.id, seed: 's' })
      expect(sorted[sorted.length - 1].isUnavailable, strategy.id).toBe(true)
    }
  })

  test('keep their original relative order at the bottom', () => {
    const tracks = [makeUnavailable(0), makeUnavailable(1), makeTrack({ name: 'z' }, 2)]
    expect(sortTracks(tracks, { strategy: 'title' }).map((t) => t.originalIndex)).toEqual([2, 0, 1])
  })
})

describe('invariants across every strategy', () => {
  const sample = () => [
    ...makeTracks([
      { name: 'one', artists: artist('a', 'A'), addedAt: '2020-01-01T00:00:00Z' },
      { name: 'two', artists: artist('b', 'B'), addedAt: '2021-01-01T00:00:00Z' },
      { name: 'three', artists: artist('a', 'A'), addedAt: '2019-01-01T00:00:00Z' },
      { name: 'dupe', artists: artist('c', 'C') },
      { name: 'dupe', artists: artist('c', 'C') },
    ]),
    makeEpisode({}, 5),
    makeUnavailable(6),
  ]

  test('every strategy returns a permutation of its input', () => {
    for (const strategy of STRATEGIES) {
      const tracks = sample()
      const sorted = sortTracks(tracks, { strategy: strategy.id, seed: 'seed' })
      expect(sorted, strategy.id).toHaveLength(tracks.length)
      expect(
        [...sorted].sort((a, b) => a.originalIndex - b.originalIndex),
        strategy.id,
      ).toEqual(tracks)
    }
  })

  test('no strategy mutates the input array', () => {
    for (const strategy of STRATEGIES) {
      const tracks = sample()
      const snapshot = [...tracks]
      sortTracks(tracks, { strategy: strategy.id, seed: 'seed' })
      expect(tracks, strategy.id).toEqual(snapshot)
    }
  })

  test('every strategy handles an empty playlist', () => {
    for (const strategy of STRATEGIES) {
      expect(sortTracks([], { strategy: strategy.id, seed: 's' }), strategy.id).toEqual([])
    }
  })
})
