import { describe, expect, test, vi } from 'vitest'
import { fetchAllPages, fetchPlaylistTracks, getCurrentUser, listEditablePlaylists } from './playlists.js'

function fakeClient(routes) {
  const calls = []
  return {
    calls,
    get: vi.fn(async (path, options) => {
      calls.push({ path, options })
      const key = Object.keys(routes).find((route) => path.startsWith(route))
      if (!key) throw new Error(`no route for ${path}`)
      const handler = routes[key]
      return typeof handler === 'function' ? handler(path, options) : handler
    }),
  }
}

const playlist = (id, name, ownerId, extra = {}) => ({
  id,
  name,
  description: '',
  collaborative: false,
  public: true,
  snapshot_id: `snap-${id}`,
  images: [{ url: `https://img/${id}` }],
  owner: { id: ownerId, display_name: ownerId },
  tracks: { total: 10 },
  ...extra,
})

describe('fetchAllPages', () => {
  test('follows next links until the last page', async () => {
    const client = fakeClient({
      '/first': { items: [1, 2], next: 'https://api.spotify.com/v1/second' },
      'https://api.spotify.com/v1/second': { items: [3], next: null },
    })
    expect(await fetchAllPages(client, '/first')).toEqual([1, 2, 3])
  })

  test('handles a single page with no next link', async () => {
    const client = fakeClient({ '/only': { items: ['a'], next: null } })
    expect(await fetchAllPages(client, '/only')).toEqual(['a'])
  })

  test('handles an empty collection', async () => {
    const client = fakeClient({ '/none': { items: [], next: null } })
    expect(await fetchAllPages(client, '/none')).toEqual([])
  })

  test('reports progress as pages arrive, so long fetches can show a bar', async () => {
    const client = fakeClient({
      '/p': { items: [1, 2], next: 'https://api.spotify.com/v1/p2', total: 3 },
      'https://api.spotify.com/v1/p2': { items: [3], next: null, total: 3 },
    })
    const seen = []
    await fetchAllPages(client, '/p', { onProgress: (loaded, total) => seen.push([loaded, total]) })
    expect(seen).toEqual([[2, 3], [3, 3]])
  })
})

describe('getCurrentUser', () => {
  test('reduces the profile to what the app actually uses', async () => {
    const client = fakeClient({
      '/me': { id: 'u1', display_name: 'Soans', images: [{ url: 'https://img/me' }] },
    })
    expect(await getCurrentUser(client)).toEqual({
      id: 'u1',
      displayName: 'Soans',
      imageUrl: 'https://img/me',
    })
  })

  test('survives a profile with no avatar', async () => {
    const client = fakeClient({ '/me': { id: 'u1', display_name: null, images: [] } })
    expect(await getCurrentUser(client)).toMatchObject({ imageUrl: null, displayName: 'u1' })
  })
})

describe('listEditablePlaylists', () => {
  test('marks playlists the user owns as editable', async () => {
    const client = fakeClient({
      '/me/playlists': { items: [playlist('p1', 'Mine', 'u1')], next: null },
    })
    const [result] = await listEditablePlaylists(client, 'u1')
    expect(result).toMatchObject({ id: 'p1', name: 'Mine', editable: true, trackCount: 10 })
  })

  test('marks a playlist owned by someone else as not editable', async () => {
    const client = fakeClient({
      '/me/playlists': { items: [playlist('p2', 'Theirs', 'someone')], next: null },
    })
    const [result] = await listEditablePlaylists(client, 'u1')
    expect(result.editable).toBe(false)
  })

  test('treats a collaborative playlist as editable even when owned by another user', async () => {
    const client = fakeClient({
      '/me/playlists': {
        items: [playlist('p3', 'Shared', 'someone', { collaborative: true })],
        next: null,
      },
    })
    const [result] = await listEditablePlaylists(client, 'u1')
    expect(result.editable).toBe(true)
  })

  test('keeps the snapshot id, which every write has to quote', async () => {
    const client = fakeClient({
      '/me/playlists': { items: [playlist('p1', 'Mine', 'u1')], next: null },
    })
    const [result] = await listEditablePlaylists(client, 'u1')
    expect(result.snapshotId).toBe('snap-p1')
  })

  test('skips null entries, which Spotify occasionally returns', async () => {
    const client = fakeClient({
      '/me/playlists': { items: [null, playlist('p1', 'Mine', 'u1')], next: null },
    })
    expect(await listEditablePlaylists(client, 'u1')).toHaveLength(1)
  })
})

describe('fetchPlaylistTracks', () => {
  const item = (id, name) => ({
    added_at: '2020-01-01T00:00:00Z',
    is_local: false,
    track: {
      id,
      uri: `spotify:track:${id}`,
      name,
      type: 'track',
      duration_ms: 1000,
      artists: [{ id: 'a', name: 'A' }],
      album: { id: 'al', name: 'Al', release_date: '2000' },
    },
  })

  test('returns normalized tracks numbered by playlist position', async () => {
    const client = fakeClient({
      '/playlists/p1/tracks': { items: [item('t1', 'One'), item('t2', 'Two')], next: null },
    })
    const tracks = await fetchPlaylistTracks(client, 'p1')
    expect(tracks.map((t) => [t.name, t.originalIndex])).toEqual([['One', 0], ['Two', 1]])
  })

  test('numbers continue across page boundaries', async () => {
    const client = fakeClient({
      '/playlists/p1/tracks': {
        items: [item('t1', 'One')],
        next: 'https://api.spotify.com/v1/playlists/p1/tracks?offset=1',
      },
      'https://api.spotify.com/v1/playlists/p1/tracks': { items: [item('t2', 'Two')], next: null },
    })
    const tracks = await fetchPlaylistTracks(client, 'p1')
    expect(tracks.map((t) => t.originalIndex)).toEqual([0, 1])
  })

  test('requests a trimmed field projection rather than the full payload', async () => {
    const client = fakeClient({ '/playlists/p1/tracks': { items: [], next: null } })
    await fetchPlaylistTracks(client, 'p1')
    const { query } = client.calls[0].options
    expect(query.fields).toContain('added_at')
    expect(query.fields).toContain('release_date')
    expect(query.limit).toBe(100)
  })
})
