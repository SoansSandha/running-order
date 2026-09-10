import { describe, expect, test } from 'vitest'
import { makeTracks } from '../test/factory.js'
import {
  byAddedAt,
  byAlbumThenTrack,
  byDuration,
  byOriginalIndex,
  byPopularity,
  byReleaseDate,
  byTitle,
  chain,
  withDirection,
} from './comparators.js'

const namesAfter = (tracks, comparator) => [...tracks].sort(comparator).map((t) => t.name)

describe('byTitle', () => {
  test('orders alphabetically, ignoring case', () => {
    const tracks = makeTracks([{ name: 'zebra' }, { name: 'Apple' }, { name: 'mango' }])
    expect(namesAfter(tracks, byTitle)).toEqual(['Apple', 'mango', 'zebra'])
  })

  test('ignores diacritics rather than banishing them to the end', () => {
    const tracks = makeTracks([{ name: 'Zoo' }, { name: 'Éclair' }, { name: 'Dog' }])
    expect(namesAfter(tracks, byTitle)).toEqual(['Dog', 'Éclair', 'Zoo'])
  })

  test('keeps a leading article, unlike artist keys', () => {
    // "The Beatles" files under B, but a song called "The Wall" files under T.
    const tracks = makeTracks([{ name: 'The Wall' }, { name: 'Umbrella' }, { name: 'Sunset' }])
    expect(namesAfter(tracks, byTitle)).toEqual(['Sunset', 'The Wall', 'Umbrella'])
  })

  test('orders numbers within titles naturally, not lexically', () => {
    const tracks = makeTracks([{ name: 'Part 10' }, { name: 'Part 2' }])
    expect(namesAfter(tracks, byTitle)).toEqual(['Part 2', 'Part 10'])
  })
})

describe('byDuration', () => {
  test('orders shortest first', () => {
    const tracks = makeTracks([
      { name: 'long', durationMs: 400000 },
      { name: 'short', durationMs: 90000 },
      { name: 'mid', durationMs: 200000 },
    ])
    expect(namesAfter(tracks, byDuration)).toEqual(['short', 'mid', 'long'])
  })
})

describe('byPopularity', () => {
  test('orders least popular first, leaving direction to the strategy', () => {
    const tracks = makeTracks([
      { name: 'hit', popularity: 90 },
      { name: 'deep cut', popularity: 12 },
    ])
    expect(namesAfter(tracks, byPopularity)).toEqual(['deep cut', 'hit'])
  })
})

describe('byReleaseDate', () => {
  test('orders oldest first across mixed precision', () => {
    const tracks = makeTracks([
      { name: 'day', releaseDate: '1972-03-24' },
      { name: 'year', releaseDate: '1969' },
      { name: 'month', releaseDate: '1972-01' },
    ])
    expect(namesAfter(tracks, byReleaseDate)).toEqual(['year', 'month', 'day'])
  })
})

describe('byAddedAt', () => {
  test('orders oldest addition first', () => {
    const tracks = makeTracks([
      { name: 'newest', addedAt: '2024-06-01T00:00:00Z' },
      { name: 'oldest', addedAt: '2015-02-02T00:00:00Z' },
      { name: 'middle', addedAt: '2020-01-01T00:00:00Z' },
    ])
    expect(namesAfter(tracks, byAddedAt)).toEqual(['oldest', 'middle', 'newest'])
  })
})

describe('byAlbumThenTrack', () => {
  test('groups by album, then reads the album in disc and track order', () => {
    const tracks = makeTracks([
      { name: 'B-d2t1', album: 'Beta', discNumber: 2, trackNumber: 1 },
      { name: 'A-t2', album: 'Alpha', discNumber: 1, trackNumber: 2 },
      { name: 'B-d1t5', album: 'Beta', discNumber: 1, trackNumber: 5 },
      { name: 'A-t1', album: 'Alpha', discNumber: 1, trackNumber: 1 },
    ])
    expect(namesAfter(tracks, byAlbumThenTrack)).toEqual(['A-t1', 'A-t2', 'B-d1t5', 'B-d2t1'])
  })
})

describe('byOriginalIndex', () => {
  test('restores the order the playlist was fetched in', () => {
    const tracks = makeTracks([{ name: 'first' }, { name: 'second' }, { name: 'third' }])
    const scrambled = [tracks[2], tracks[0], tracks[1]]
    expect(namesAfter(scrambled, byOriginalIndex)).toEqual(['first', 'second', 'third'])
  })
})

describe('chain', () => {
  test('falls through to the next comparator only on a tie', () => {
    const tracks = makeTracks([
      { name: 'b', popularity: 50 },
      { name: 'a', popularity: 50 },
      { name: 'c', popularity: 10 },
    ])
    expect(namesAfter(tracks, chain(byPopularity, byTitle))).toEqual(['c', 'a', 'b'])
  })

  test('is stable via originalIndex when every comparator ties', () => {
    const tracks = makeTracks([{ name: 'x' }, { name: 'x' }, { name: 'x' }])
    const scrambled = [tracks[1], tracks[2], tracks[0]]
    const sorted = [...scrambled].sort(chain(byTitle, byOriginalIndex))
    expect(sorted.map((t) => t.originalIndex)).toEqual([0, 1, 2])
  })
})

describe('withDirection', () => {
  test('leaves a comparator alone when ascending', () => {
    const tracks = makeTracks([{ name: 'b' }, { name: 'a' }])
    expect(namesAfter(tracks, withDirection(byTitle, 'asc'))).toEqual(['a', 'b'])
  })

  test('inverts a comparator when descending', () => {
    const tracks = makeTracks([{ name: 'b' }, { name: 'a' }, { name: 'c' }])
    expect(namesAfter(tracks, withDirection(byTitle, 'desc'))).toEqual(['c', 'b', 'a'])
  })
})
