import { describe, expect, test } from 'vitest'
import { makeTracks } from '../test/factory.js'
import { buildCsvOrder } from './order.js'

const names = (tracks) => tracks.map((t) => t.name)
const artist = (id, name) => [{ id, name }]

const TITLE_ARTIST = {
  columns: { uri: null, isrc: null, title: 0, artist: 1, album: null },
  hasHeader: false,
}

const playlist = () =>
  makeTracks([
    { name: 'Alpha', artists: artist('a', 'A') },
    { name: 'Bravo', artists: artist('a', 'A') },
    { name: 'Charlie', artists: artist('a', 'A') },
  ])

describe('buildCsvOrder', () => {
  test('puts matched tracks in the order the CSV lists them', () => {
    const tracks = playlist()
    const rows = [['Charlie', 'A'], ['Alpha', 'A'], ['Bravo', 'A']]
    expect(names(buildCsvOrder(tracks, rows, TITLE_ARTIST))).toEqual(['Charlie', 'Alpha', 'Bravo'])
  })

  test('sends tracks the CSV never mentions to the bottom', () => {
    const tracks = playlist()
    const rows = [['Charlie', 'A']]
    expect(names(buildCsvOrder(tracks, rows, TITLE_ARTIST))).toEqual(['Charlie', 'Alpha', 'Bravo'])
  })

  test('keeps unmentioned tracks in their original relative order', () => {
    const tracks = playlist()
    const rows = [['Bravo', 'A']]
    expect(names(buildCsvOrder(tracks, rows, TITLE_ARTIST))).toEqual(['Bravo', 'Alpha', 'Charlie'])
  })

  test('can put unmentioned tracks on top instead', () => {
    const tracks = playlist()
    const rows = [['Charlie', 'A']]
    const ordered = buildCsvOrder(tracks, rows, { ...TITLE_ARTIST, unmatchedPosition: 'top' })
    expect(names(ordered)).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })

  test('ignores CSV rows that match nothing', () => {
    const tracks = playlist()
    const rows = [['Nonexistent', 'Z'], ['Bravo', 'A']]
    expect(names(buildCsvOrder(tracks, rows, TITLE_ARTIST))).toEqual(['Bravo', 'Alpha', 'Charlie'])
  })

  // A one-letter typo only clears the 0.9 Dice gate on a reasonably long
  // title; on a short one it scores far lower and never becomes a suggestion.
  const withLongTitle = () =>
    makeTracks([
      { name: 'Bohemian Rhapsody', artists: artist('a', 'A') },
      { name: 'Alpha', artists: artist('a', 'A') },
      { name: 'Bravo', artists: artist('a', 'A') },
    ])

  test('places an accepted fuzzy suggestion at its CSV position', () => {
    const rows = [['Bohemian Rapsody', 'A'], ['Alpha', 'A']]
    const ordered = buildCsvOrder(withLongTitle(), rows, {
      ...TITLE_ARTIST,
      acceptedSuggestions: [0],
    })
    expect(names(ordered)).toEqual(['Bohemian Rhapsody', 'Alpha', 'Bravo'])
  })

  test('leaves a rejected suggestion unplaced, so that track keeps its slot', () => {
    const rows = [['Bohemian Rapsody', 'A'], ['Alpha', 'A']]
    const ordered = buildCsvOrder(withLongTitle(), rows, TITLE_ARTIST)
    expect(names(ordered)).toEqual(['Alpha', 'Bohemian Rhapsody', 'Bravo'])
  })

  test('returns the report alongside the order when asked', () => {
    const tracks = playlist()
    const { order, report } = buildCsvOrder(tracks, [['Alpha', 'A']], TITLE_ARTIST, { withReport: true })
    expect(names(order)).toEqual(['Alpha', 'Bravo', 'Charlie'])
    expect(report.counts.matched).toBe(1)
  })
})

describe('invariants', () => {
  test('is always a permutation of the playlist', () => {
    const tracks = playlist()
    const ordered = buildCsvOrder(tracks, [['Charlie', 'A'], ['Nope', 'Z']], TITLE_ARTIST)
    expect(ordered).toHaveLength(tracks.length)
    expect([...ordered].sort((a, b) => a.originalIndex - b.originalIndex)).toEqual(tracks)
  })

  test('never places a track twice, even if two rows point at it', () => {
    const tracks = playlist()
    const ordered = buildCsvOrder(tracks, [['Alpha', 'A'], ['Alpha', 'A']], TITLE_ARTIST)
    expect(ordered).toHaveLength(3)
    expect(new Set(ordered.map((t) => t.originalIndex)).size).toBe(3)
  })

  test('does not mutate the input array', () => {
    const tracks = playlist()
    const snapshot = [...tracks]
    buildCsvOrder(tracks, [['Charlie', 'A']], TITLE_ARTIST)
    expect(tracks).toEqual(snapshot)
  })

  test('returns the playlist untouched for an empty CSV', () => {
    const tracks = playlist()
    expect(names(buildCsvOrder(tracks, [], TITLE_ARTIST))).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })

  test('handles an empty playlist', () => {
    expect(buildCsvOrder([], [['Alpha', 'A']], TITLE_ARTIST)).toEqual([])
  })
})
