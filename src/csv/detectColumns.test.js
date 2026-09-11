import { describe, expect, test } from 'vitest'
import { detectColumns } from './detectColumns.js'

// Exportify is the CSV exporter people actually use, and its header row is
// full of near-miss names. Getting this wrong sends the matcher looking up
// artist URIs as though they were track URIs.
const EXPORTIFY = [
  'Track URI',
  'Track Name',
  'Artist URI(s)',
  'Artist Name(s)',
  'Album URI',
  'Album Name',
  'Album Artist Name(s)',
  'Album Release Date',
  'Disc Number',
  'Track Number',
  'Track Duration (ms)',
  'ISRC',
  'Added At',
]

describe('detectColumns — Exportify', () => {
  const detected = detectColumns([EXPORTIFY, ['spotify:track:abc', 'Song', 'spotify:artist:x', 'Band', '', '', '', '', '', '', '', 'USUM71", ', '']])

  test('recognises the header row', () => {
    expect(detected.hasHeader).toBe(true)
  })

  test('picks Track URI, not Artist URI or Album URI', () => {
    expect(detected.columns.uri).toBe(EXPORTIFY.indexOf('Track URI'))
  })

  test('picks Track Name for the title, not Album Name', () => {
    expect(detected.columns.title).toBe(EXPORTIFY.indexOf('Track Name'))
  })

  test('picks Artist Name(s), not Album Artist Name(s)', () => {
    expect(detected.columns.artist).toBe(EXPORTIFY.indexOf('Artist Name(s)'))
  })

  test('picks Album Name for the album, not Album Artist Name(s)', () => {
    expect(detected.columns.album).toBe(EXPORTIFY.indexOf('Album Name'))
  })

  test('finds the ISRC column', () => {
    expect(detected.columns.isrc).toBe(EXPORTIFY.indexOf('ISRC'))
  })
})

describe('detectColumns — generic headers', () => {
  test('matches simple Title and Artist headers', () => {
    const { columns } = detectColumns([['Title', 'Artist'], ['Song', 'Band']])
    expect(columns.title).toBe(0)
    expect(columns.artist).toBe(1)
  })

  test('ignores case and punctuation in header names', () => {
    const { columns } = detectColumns([['  TRACK_NAME ', 'artist name'], ['Song', 'Band']])
    expect(columns.title).toBe(0)
    expect(columns.artist).toBe(1)
  })

  test('accepts Song as a title synonym', () => {
    expect(detectColumns([['Song', 'Performer'], ['a', 'b']]).columns.title).toBe(0)
  })

  test('leaves a field null when no column resembles it', () => {
    const { columns } = detectColumns([['Title'], ['Song']])
    expect(columns.artist).toBe(null)
    expect(columns.isrc).toBe(null)
  })
})

describe('detectColumns — headerless files', () => {
  test('recognises a track URI by its shape when there is no header', () => {
    const { hasHeader, columns } = detectColumns([
      ['spotify:track:4cOdK2wGLETKBW3PvgPWqT', 'Never Gonna Give You Up'],
      ['spotify:track:1301WleyT98MSxVHPZCA6M', 'Together Forever'],
    ])
    expect(hasHeader).toBe(false)
    expect(columns.uri).toBe(0)
  })

  test('recognises an open.spotify.com track link', () => {
    const { columns } = detectColumns([
      ['https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=x', 'Song'],
    ])
    expect(columns.uri).toBe(0)
  })

  test('does not mistake an artist URI for a track URI', () => {
    const { columns } = detectColumns([['spotify:artist:0gxyHStUsqpMadRV0Di1Qt', 'Song']])
    expect(columns.uri).toBe(null)
  })

  test('reports no header when the first row looks like data', () => {
    expect(detectColumns([['Bohemian Rhapsody', 'Queen'], ['Under Pressure', 'Queen']]).hasHeader)
      .toBe(false)
  })
})

describe('detectColumns — edge cases', () => {
  test('handles an empty file without throwing', () => {
    const { hasHeader, columns } = detectColumns([])
    expect(hasHeader).toBe(false)
    expect(columns.title).toBe(null)
  })

  test('handles a header row with no recognisable columns', () => {
    const { columns } = detectColumns([['foo', 'bar'], ['1', '2']])
    expect(columns).toEqual({ uri: null, isrc: null, title: null, artist: null, album: null })
  })

  test('reports which headers it saw, so the mapping UI can list them', () => {
    expect(detectColumns([['Title', 'Artist'], ['a', 'b']]).headers).toEqual(['Title', 'Artist'])
  })

  test('names headerless columns positionally for the mapping UI', () => {
    expect(detectColumns([['Bohemian Rhapsody', 'Queen']]).headers).toEqual(['Column 1', 'Column 2'])
  })
})
