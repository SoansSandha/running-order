import { describe, expect, test, vi } from 'vitest'
import { getTrack, searchTracks } from './search.js'

// A search result as the Web API returns it: a bare track object.
const track = (id, name, artist, durationMs) => ({
  id,
  uri: `spotify:track:${id}`,
  type: 'track',
  name,
  duration_ms: durationMs,
  artists: [{ id: `artist-${artist}`, name: artist }],
  album: { id: 'album-1', name: 'Sheesha', release_date: '2022-06-17', release_date_precision: 'day' },
  external_ids: { isrc: 'GBKQU2290001' },
})

const clientAnswering = (body) => ({ get: vi.fn(async () => body) })

describe('searchTracks', () => {
  test('asks Spotify for tracks with the query and a limit of 10', async () => {
    const client = clientAnswering({ tracks: { items: [] } })
    await searchTracks(client, 'track:"sheesha" artist:"Karan Aujla"')
    expect(client.get).toHaveBeenCalledWith('/search', {
      query: { q: 'track:"sheesha" artist:"Karan Aujla"', type: 'track', limit: 10 },
    })
  })

  test('normalizes a result exactly as a playlist row is', async () => {
    const client = clientAnswering({ tracks: { items: [track('t1', 'Sheesha', 'Karan Aujla', 161000)] } })
    const [found] = await searchTracks(client, 'q')
    expect(found).toMatchObject({
      id: 't1',
      uri: 'spotify:track:t1',
      name: 'Sheesha',
      durationMs: 161000,
      isrc: 'GBKQU2290001',
      source: 'spotify',
      isUnavailable: false,
      originalIndex: 0,
    })
    expect(found.primaryArtist.name).toBe('Karan Aujla')
  })

  test('a null among the results is skipped, not read as an unavailable track', async () => {
    const client = clientAnswering({ tracks: { items: [null, track('t1', 'Sheesha', 'Karan Aujla', 161000)] } })
    expect((await searchTracks(client, 'q')).map((found) => [found.id, found.originalIndex])).toEqual([['t1', 0]])
  })

  test('an answer with no tracks is no results', async () => {
    expect(await searchTracks(clientAnswering({}), 'q')).toEqual([])
  })
})

describe('getTrack', () => {
  test('reads one track by id, normalized as a playlist row is', async () => {
    const client = clientAnswering(track('7fnd0BMPbWuMsn6lBrshZL', 'Taal Se Taal - Remix', 'Alka Yagnik', 164848))
    const found = await getTrack(client, '7fnd0BMPbWuMsn6lBrshZL')
    expect(client.get).toHaveBeenCalledWith('/tracks/7fnd0BMPbWuMsn6lBrshZL')
    expect(found).toMatchObject({
      id: '7fnd0BMPbWuMsn6lBrshZL',
      name: 'Taal Se Taal - Remix',
      durationMs: 164848,
      source: 'spotify',
    })
  })
})
