import { describe, expect, test } from 'vitest'
import { makeTracks } from '../test/factory.js'
import { matchCsvToTracks, matchText } from './match.js'

const artist = (id, name) => [{ id, name }]

/** Columns for a `title,artist` CSV with no header. */
const TITLE_ARTIST = { columns: { uri: null, isrc: null, title: 0, artist: 1, album: null }, hasHeader: false }

describe('matchText', () => {
  test('lowercases and strips diacritics', () => {
    expect(matchText('Crème Brûlée')).toBe(matchText('creme brulee'))
  })

  test('drops a featured-artist suffix, which CSVs inconsistently include', () => {
    expect(matchText('Work (feat. Drake)')).toBe(matchText('Work'))
    expect(matchText('Work (ft. Drake)')).toBe(matchText('Work'))
    expect(matchText('Work (with Drake)')).toBe(matchText('Work'))
  })

  test('drops remaster annotations in brackets or after a dash', () => {
    expect(matchText('Come Together [Remastered 2009]')).toBe(matchText('Come Together'))
    expect(matchText('Come Together - 2009 Remaster')).toBe(matchText('Come Together'))
  })

  test('drops a single or album version suffix', () => {
    expect(matchText('Alive - Single Version')).toBe(matchText('Alive'))
  })

  test('keeps Live, because a live cut is a different recording', () => {
    // Over-normalizing invents wrong matches. Under-normalizing only sends
    // the row to the fuzzy tier, where a human confirms it.
    expect(matchText('Alive (Live)')).not.toBe(matchText('Alive'))
  })

  test('keeps Remix for the same reason', () => {
    expect(matchText('Alive (Kaytranada Remix)')).not.toBe(matchText('Alive'))
  })

  test('ignores punctuation and spacing differences', () => {
    expect(matchText("Don't Stop  Me,  Now!")).toBe(matchText('Dont Stop Me Now'))
  })
})

describe('matching by identifier', () => {
  const tracks = makeTracks([
    { id: 'aaa11111111111111111111', name: 'One' },
    { id: 'bbb22222222222222222222', name: 'Two' },
  ])

  test('matches a full spotify track URI', () => {
    const result = matchCsvToTracks([['spotify:track:bbb22222222222222222222']], tracks, {
      columns: { uri: 0, isrc: null, title: null, artist: null, album: null },
      hasHeader: false,
    })
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0].track.name).toBe('Two')
    expect(result.matches[0].tier).toBe('uri')
  })

  test('matches a bare track id', () => {
    const result = matchCsvToTracks([['aaa11111111111111111111']], tracks, {
      columns: { uri: 0, isrc: null, title: null, artist: null, album: null },
      hasHeader: false,
    })
    expect(result.matches[0].track.name).toBe('One')
  })

  test('matches an open.spotify.com link, query string and all', () => {
    const result = matchCsvToTracks(
      [['https://open.spotify.com/track/bbb22222222222222222222?si=abc123']],
      tracks,
      { columns: { uri: 0, isrc: null, title: null, artist: null, album: null }, hasHeader: false },
    )
    expect(result.matches[0].track.name).toBe('Two')
  })

  test('matches by ISRC when there is no URI column', () => {
    const withIsrc = makeTracks([
      { name: 'One', isrc: 'GBAYE0601477' },
      { name: 'Two', isrc: 'USUM71703861' },
    ])
    const result = matchCsvToTracks([['USUM71703861']], withIsrc, {
      columns: { uri: null, isrc: 0, title: null, artist: null, album: null },
      hasHeader: false,
    })
    expect(result.matches[0].track.name).toBe('Two')
    expect(result.matches[0].tier).toBe('isrc')
  })
})

describe('matching by title and artist', () => {
  const tracks = makeTracks([
    { name: 'Hotline Bling', artists: artist('drake', 'Drake') },
    { name: 'Work', artists: [{ id: 'rih', name: 'Rihanna' }, { id: 'drake', name: 'Drake' }] },
  ])

  test('matches on title plus primary artist', () => {
    const result = matchCsvToTracks([['Hotline Bling', 'Drake']], tracks, TITLE_ARTIST)
    expect(result.matches[0].track.name).toBe('Hotline Bling')
    expect(result.matches[0].tier).toBe('titleArtist')
  })

  test('matches when the CSV credits a featured artist instead of the primary', () => {
    const result = matchCsvToTracks([['Work', 'Drake']], tracks, TITLE_ARTIST)
    expect(result.matches[0].track.name).toBe('Work')
    expect(result.matches[0].tier).toBe('titleAnyArtist')
  })

  test('matches when the CSV lists several artists in one cell', () => {
    const result = matchCsvToTracks([['Work', 'Rihanna, Drake']], tracks, TITLE_ARTIST)
    expect(result.matches[0].track.name).toBe('Work')
  })

  test('ignores a leading article on the artist name', () => {
    const beatles = makeTracks([{ name: 'Come Together', artists: artist('b', 'The Beatles') }])
    const result = matchCsvToTracks([['Come Together', 'Beatles']], beatles, TITLE_ARTIST)
    expect(result.matches).toHaveLength(1)
  })

  test('does not match the right title against the wrong artist', () => {
    const result = matchCsvToTracks([['Hotline Bling', 'Adele']], tracks, TITLE_ARTIST)
    expect(result.matches).toHaveLength(0)
  })
})

describe('fuzzy tier', () => {
  const tracks = makeTracks([{ name: 'Bohemian Rhapsody', artists: artist('q', 'Queen') }])

  test('offers a near-miss title as a suggestion rather than applying it', () => {
    const result = matchCsvToTracks([['Bohemian Rapsody', 'Queen']], tracks, TITLE_ARTIST)
    expect(result.matches).toHaveLength(0)
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0].track.name).toBe('Bohemian Rhapsody')
  })

  test('reports the similarity score so the review UI can rank suggestions', () => {
    const result = matchCsvToTracks([['Bohemian Rapsody', 'Queen']], tracks, TITLE_ARTIST)
    expect(result.suggestions[0].score).toBeGreaterThan(0.9)
    expect(result.suggestions[0].score).toBeLessThanOrEqual(1)
  })

  test('carries the row text, so a review UI can show what the CSV asked for', () => {
    const result = matchCsvToTracks([['Bohemian Rapsody', 'Queen']], tracks, TITLE_ARTIST)
    expect(result.suggestions[0]).toMatchObject({
      title: 'Bohemian Rapsody',
      artist: 'Queen',
    })
  })

  test('does not suggest anything for a genuinely different title', () => {
    const result = matchCsvToTracks([['Radio Ga Ga', 'Queen']], tracks, TITLE_ARTIST)
    expect(result.suggestions).toHaveLength(0)
    expect(result.unmatchedRows).toHaveLength(1)
  })

  test('will not suggest across different artists', () => {
    const result = matchCsvToTracks([['Bohemian Rapsody', 'Adele']], tracks, TITLE_ARTIST)
    expect(result.suggestions).toHaveLength(0)
  })
})

describe('duplicates', () => {
  test('pairs two CSV rows with two playlist copies of the same track', () => {
    const tracks = makeTracks([
      { id: 'same1111111111111111111', name: 'Echo' },
      { id: 'same1111111111111111111', name: 'Echo' },
    ])
    const rows = [['spotify:track:same1111111111111111111'], ['spotify:track:same1111111111111111111']]
    const result = matchCsvToTracks(rows, tracks, {
      columns: { uri: 0, isrc: null, title: null, artist: null, album: null },
      hasHeader: false,
    })
    expect(result.matches).toHaveLength(2)
    expect(result.matches[0].track.originalIndex).not.toBe(result.matches[1].track.originalIndex)
  })

  test('leaves the surplus row unmatched when the playlist has only one copy', () => {
    const tracks = makeTracks([{ id: 'same1111111111111111111', name: 'Echo' }])
    const rows = [['spotify:track:same1111111111111111111'], ['spotify:track:same1111111111111111111']]
    const result = matchCsvToTracks(rows, tracks, {
      columns: { uri: 0, isrc: null, title: null, artist: null, album: null },
      hasHeader: false,
    })
    expect(result.matches).toHaveLength(1)
    expect(result.unmatchedRows).toHaveLength(1)
  })

  test('counts repeated CSV rows so the report can mention them', () => {
    const tracks = makeTracks([{ name: 'Echo', artists: artist('a', 'A') }])
    const result = matchCsvToTracks([['Echo', 'A'], ['Echo', 'A']], tracks, TITLE_ARTIST)
    expect(result.duplicateRows).toHaveLength(1)
  })

  test('never assigns one playlist track to two rows', () => {
    const tracks = makeTracks([{ name: 'Echo', artists: artist('a', 'A') }])
    const result = matchCsvToTracks([['Echo', 'A'], ['Echo', 'A']], tracks, TITLE_ARTIST)
    expect(result.matches).toHaveLength(1)
  })
})

describe('the report', () => {
  const tracks = makeTracks([
    { name: 'Kept', artists: artist('a', 'A') },
    { name: 'Also Kept', artists: artist('a', 'A') },
    { name: 'Not In Csv', artists: artist('a', 'A') },
  ])
  const rows = [
    ['Kept', 'A'],
    ['Also Kept', 'A'],
    ['Never Heard Of It', 'Z'],
  ]
  const result = matchCsvToTracks(rows, tracks, TITLE_ARTIST)

  test('lists playlist tracks the CSV never mentions', () => {
    expect(result.unmatchedTracks.map((t) => t.name)).toEqual(['Not In Csv'])
  })

  test('lists CSV rows with no playlist match, with their text for display', () => {
    expect(result.unmatchedRows).toEqual([
      { rowIndex: 2, title: 'Never Heard Of It', artist: 'Z' },
    ])
  })

  test('counts every category, so the report adds up', () => {
    expect(result.counts).toMatchObject({
      csvRows: 3,
      playlistTracks: 3,
      matched: 2,
      unmatchedRows: 1,
      unmatchedTracks: 1,
    })
  })

  test('breaks the matched count down by tier', () => {
    expect(result.counts.byTier.titleArtist).toBe(2)
    expect(result.counts.byTier.uri).toBe(0)
  })
})

describe('header handling', () => {
  test('skips the header row when the file has one', () => {
    const tracks = makeTracks([{ name: 'Song', artists: artist('a', 'Band') }])
    const rows = [['Title', 'Artist'], ['Song', 'Band']]
    const result = matchCsvToTracks(rows, tracks, {
      columns: { uri: null, isrc: null, title: 0, artist: 1, album: null },
      hasHeader: true,
    })
    expect(result.counts.csvRows).toBe(1)
    expect(result.matches).toHaveLength(1)
  })

  test('ignores blank rows rather than reporting them as unmatched', () => {
    const tracks = makeTracks([{ name: 'Song', artists: artist('a', 'Band') }])
    const result = matchCsvToTracks([['Song', 'Band'], ['', '']], tracks, TITLE_ARTIST)
    expect(result.counts.csvRows).toBe(1)
    expect(result.unmatchedRows).toHaveLength(0)
  })

  test('handles an empty CSV against a full playlist', () => {
    const tracks = makeTracks([{ name: 'Song' }])
    const result = matchCsvToTracks([], tracks, TITLE_ARTIST)
    expect(result.matches).toHaveLength(0)
    expect(result.unmatchedTracks).toHaveLength(1)
  })
})
