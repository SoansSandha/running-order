import { describe, expect, test } from 'vitest'
import { makeEpisode, makeTrack, makeTracks, makeUnavailable } from '../test/factory.js'
import { artistGrouped } from './artistGrouped.js'

const names = (tracks) => tracks.map((t) => t.name)
const artistOf = (track) => track.primaryArtist?.name ?? track.showName ?? null

const artist = (id, name) => [{ id, name }]

describe('artist block ordering', () => {
  test('orders artist blocks alphabetically', () => {
    const tracks = makeTracks([
      { name: 'z', artists: artist('a3', 'Zayn') },
      { name: 'a', artists: artist('a1', 'ABBA') },
      { name: 'm', artists: artist('a2', 'MGMT') },
    ])
    expect(names(artistGrouped(tracks))).toEqual(['a', 'm', 'z'])
  })

  test('files a leading article under the following word', () => {
    // "The Beatles" belongs between ABBA and Zayn, not at the front under T.
    const tracks = makeTracks([
      { name: 'z', artists: artist('a3', 'Zayn') },
      { name: 'b', artists: artist('a2', 'The Beatles') },
      { name: 'a', artists: artist('a1', 'ABBA') },
    ])
    expect(names(artistGrouped(tracks))).toEqual(['a', 'b', 'z'])
  })

  test('keeps every track by one artist contiguous', () => {
    const tracks = makeTracks([
      { name: 'b1', artists: artist('b', 'Blur') },
      { name: 'a1', artists: artist('a', 'Adele') },
      { name: 'b2', artists: artist('b', 'Blur') },
      { name: 'a2', artists: artist('a', 'Adele') },
    ])
    const sorted = artistGrouped(tracks).map(artistOf)
    expect(sorted).toEqual(['Adele', 'Adele', 'Blur', 'Blur'])
  })

  test('merges spelling variants of one artist by id, not by name', () => {
    const tracks = makeTracks([
      { name: 'accented', artists: artist('bey', 'Beyoncé') },
      { name: 'other', artists: artist('zzz', 'Zebra') },
      { name: 'plain', artists: artist('bey', 'Beyonce') },
    ])
    expect(names(artistGrouped(tracks))).toEqual(['accented', 'plain', 'other'])
  })
})

describe('ordering within an artist block', () => {
  const block = () =>
    makeTracks([
      { name: 'middle', artists: artist('a', 'A'), addedAt: '2020-01-01T00:00:00Z', releaseDate: '1999-01-01', album: 'M', trackNumber: 2 },
      { name: 'newest', artists: artist('a', 'A'), addedAt: '2024-01-01T00:00:00Z', releaseDate: '1990-01-01', album: 'A', trackNumber: 3 },
      { name: 'oldest', artists: artist('a', 'A'), addedAt: '2010-01-01T00:00:00Z', releaseDate: '2015-01-01', album: 'Z', trackNumber: 1 },
    ])

  test('defaults to date added, oldest at the top of the block', () => {
    expect(names(artistGrouped(block()))).toEqual(['oldest', 'middle', 'newest'])
  })

  test('orders by release date when asked, reading as a discography', () => {
    expect(names(artistGrouped(block(), { innerOrder: 'releaseDate' })))
      .toEqual(['newest', 'middle', 'oldest'])
  })

  test('orders by album then track number when asked', () => {
    expect(names(artistGrouped(block(), { innerOrder: 'album' })))
      .toEqual(['newest', 'middle', 'oldest'])
  })

  test('orders by title when asked', () => {
    expect(names(artistGrouped(block(), { innerOrder: 'title' })))
      .toEqual(['middle', 'newest', 'oldest'])
  })

  test('breaks ties by original position, never arbitrarily', () => {
    const tracks = makeTracks([
      { name: 'first', artists: artist('a', 'A'), addedAt: '2020-01-01T00:00:00Z' },
      { name: 'second', artists: artist('a', 'A'), addedAt: '2020-01-01T00:00:00Z' },
      { name: 'third', artists: artist('a', 'A'), addedAt: '2020-01-01T00:00:00Z' },
    ])
    expect(names(artistGrouped([tracks[2], tracks[0], tracks[1]])))
      .toEqual(['first', 'second', 'third'])
  })
})

describe('album blocks inside an artist', () => {
  const onAlbum = (name, album, releaseDate, discNumber, trackNumber) => ({
    name,
    artists: artist('gill', 'Amrinder Gill'),
    album,
    releaseDate,
    discNumber,
    trackNumber,
  })

  test('release date orders whole albums oldest first, in track order inside', () => {
    // The album ordering people expect from a discography: earliest record at
    // the top of the artist's block, latest at the bottom, each read through.
    const tracks = makeTracks([
      onAlbum('Newest B', 'Judaa 3', '2022-08-05', 1, 2),
      onAlbum('Oldest A', 'Judaa', '2012-04-01', 1, 1),
      onAlbum('Middle B', 'Judaa 2', '2016-03-11', 1, 2),
      onAlbum('Newest A', 'Judaa 3', '2022-08-05', 1, 1),
      onAlbum('Oldest B', 'Judaa', '2012-04-01', 1, 2),
      onAlbum('Middle A', 'Judaa 2', '2016-03-11', 1, 1),
    ])

    expect(names(artistGrouped(tracks, { innerOrder: 'releaseDate' }))).toEqual([
      'Oldest A',
      'Oldest B',
      'Middle A',
      'Middle B',
      'Newest A',
      'Newest B',
    ])
  })

  test('a second disc follows the first, not interleaved with it', () => {
    const tracks = makeTracks([
      onAlbum('d2t1', 'Double', '2000-01-01', 2, 1),
      onAlbum('d1t2', 'Double', '2000-01-01', 1, 2),
      onAlbum('d1t1', 'Double', '2000-01-01', 1, 1),
    ])
    expect(names(artistGrouped(tracks, { innerOrder: 'releaseDate' })))
      .toEqual(['d1t1', 'd1t2', 'd2t1'])
  })

  test('two albums sharing a release date stay in separate blocks', () => {
    const tracks = makeTracks([
      onAlbum('B one', 'Beta', '2019-05-05', 1, 1),
      onAlbum('A two', 'Alpha', '2019-05-05', 1, 2),
      onAlbum('B two', 'Beta', '2019-05-05', 1, 2),
      onAlbum('A one', 'Alpha', '2019-05-05', 1, 1),
    ])
    expect(names(artistGrouped(tracks, { innerOrder: 'releaseDate' })))
      .toEqual(['A one', 'A two', 'B one', 'B two'])
  })

  test('album name order is the other album option, and keeps track order', () => {
    const tracks = makeTracks([
      onAlbum('Z two', 'Zenith', '2001-01-01', 1, 2),
      onAlbum('A one', 'Apex', '2020-01-01', 1, 1),
      onAlbum('Z one', 'Zenith', '2001-01-01', 1, 1),
    ])
    expect(names(artistGrouped(tracks, { innerOrder: 'album' })))
      .toEqual(['A one', 'Z one', 'Z two'])
  })
})

describe('collaborations', () => {
  test('files a collaboration under its primary artist only', () => {
    const tracks = makeTracks([
      { name: 'rihanna solo', artists: artist('rih', 'Rihanna') },
      { name: 'collab', artists: [{ id: 'drake', name: 'Drake' }, { id: 'rih', name: 'Rihanna' }] },
      { name: 'drake solo', artists: artist('drake', 'Drake') },
    ])
    const sorted = artistGrouped(tracks)
    expect(names(sorted)).toEqual(['collab', 'drake solo', 'rihanna solo'])
  })

  test('never changes the track count, because a reorder is a permutation', () => {
    const tracks = makeTracks([
      { name: 'collab', artists: [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }] },
      { name: 'solo', artists: artist('y', 'Y') },
    ])
    expect(artistGrouped(tracks)).toHaveLength(2)
  })
})

describe('trailing groups', () => {
  test('places episodes after every artist block, grouped by show', () => {
    const tracks = [
      makeEpisode({ name: 'ep-b', show: 'Beta' }, 0),
      makeTrack({ name: 'song-z', artists: artist('z', 'Zayn') }, 1),
      makeEpisode({ name: 'ep-a', show: 'Alpha' }, 2),
    ]
    expect(names(artistGrouped(tracks))).toEqual(['song-z', 'ep-a', 'ep-b'])
  })

  test('places unavailable tracks at the very bottom, after episodes', () => {
    const tracks = [
      makeUnavailable(0),
      makeEpisode({ name: 'ep' }, 1),
      makeTrack({ name: 'song', artists: artist('a', 'A') }, 2),
    ]
    expect(names(artistGrouped(tracks))).toEqual(['song', 'ep', ''])
  })

  test('keeps unavailable tracks in their original relative order', () => {
    const tracks = [makeUnavailable(0), makeUnavailable(1), makeTrack({ name: 'song' }, 2)]
    const sorted = artistGrouped(tracks)
    expect(sorted.map((t) => t.originalIndex)).toEqual([2, 0, 1])
  })

  test('groups local files by artist name when they have no artist id', () => {
    const tracks = [
      makeTrack({ name: 'zzz', artists: artist('z', 'Zed') }, 0),
      makeTrack({ name: 'local', artists: [{ id: null, name: 'Nirvana' }], isLocal: true }, 1),
    ]
    expect(names(artistGrouped(tracks))).toEqual(['local', 'zzz'])
  })
})

describe('invariants', () => {
  test('returns a permutation of its input', () => {
    const tracks = [
      ...makeTracks([
        { name: 'a', artists: artist('1', 'One') },
        { name: 'b', artists: artist('2', 'Two') },
        { name: 'c', artists: artist('1', 'One') },
      ]),
      makeEpisode({}, 3),
      makeUnavailable(4),
    ]
    const sorted = artistGrouped(tracks)
    expect(sorted).toHaveLength(tracks.length)
    expect([...sorted].sort((a, b) => a.originalIndex - b.originalIndex)).toEqual(tracks)
  })

  test('does not mutate the input array', () => {
    const tracks = makeTracks([{ name: 'b', artists: artist('b', 'B') }, { name: 'a', artists: artist('a', 'A') }])
    const snapshot = [...tracks]
    artistGrouped(tracks)
    expect(tracks).toEqual(snapshot)
  })

  test('handles an empty playlist', () => {
    expect(artistGrouped([])).toEqual([])
  })
})
