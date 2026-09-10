import { describe, expect, test, vi } from 'vitest'
import { addTracksInChunks, createPlaylist, reorderTrack } from './mutations.js'

function recorder(results = []) {
  const queue = [...results]
  const calls = []
  const record = (method) =>
    vi.fn(async (path, options) => {
      calls.push({ method, path, ...options })
      return queue.length ? queue.shift() : {}
    })
  return { calls, post: record('POST'), put: record('PUT') }
}

describe('reorderTrack', () => {
  test('sends the range and insertion point Spotify expects', async () => {
    const client = recorder([{ snapshot_id: 'snap2' }])
    await reorderTrack(client, 'p1', { rangeStart: 5, insertBefore: 2, rangeLength: 1 }, 'snap1')
    expect(client.calls[0]).toMatchObject({
      method: 'PUT',
      path: '/playlists/p1/tracks',
      body: { range_start: 5, insert_before: 2, range_length: 1, snapshot_id: 'snap1' },
    })
  })

  test('returns the new snapshot id, which the next call must quote', async () => {
    const client = recorder([{ snapshot_id: 'snap2' }])
    const result = await reorderTrack(client, 'p1', { rangeStart: 0, insertBefore: 1 }, 'snap1')
    expect(result).toBe('snap2')
  })

  test('defaults rangeLength to a single track', async () => {
    const client = recorder([{ snapshot_id: 's' }])
    await reorderTrack(client, 'p1', { rangeStart: 3, insertBefore: 0 }, 's0')
    expect(client.calls[0].body.range_length).toBe(1)
  })
})

describe('addTracksInChunks', () => {
  const uris = (n) => Array.from({ length: n }, (_, i) => `spotify:track:t${i}`)

  test('sends a single request when the batch fits', async () => {
    const client = recorder()
    await addTracksInChunks(client, 'p1', uris(50))
    expect(client.calls).toHaveLength(1)
    expect(client.calls[0].body.uris).toHaveLength(50)
  })

  test('splits at the hundred-URI ceiling the API imposes', async () => {
    const client = recorder()
    await addTracksInChunks(client, 'p1', uris(250))
    expect(client.calls.map((c) => c.body.uris.length)).toEqual([100, 100, 50])
  })

  test('preserves order across chunk boundaries', async () => {
    const client = recorder()
    await addTracksInChunks(client, 'p1', uris(150))
    const sent = client.calls.flatMap((c) => c.body.uris)
    expect(sent).toEqual(uris(150))
  })

  test('sends nothing at all for an empty list', async () => {
    const client = recorder()
    await addTracksInChunks(client, 'p1', [])
    expect(client.calls).toHaveLength(0)
  })

  test('reports progress per chunk so a long clone can show a bar', async () => {
    const client = recorder()
    const seen = []
    await addTracksInChunks(client, 'p1', uris(250), { onProgress: (done, total) => seen.push([done, total]) })
    expect(seen).toEqual([[100, 250], [200, 250], [250, 250]])
  })
})

describe('createPlaylist', () => {
  test('creates a private playlist under the given user', async () => {
    const client = recorder([{ id: 'new1' }])
    const created = await createPlaylist(client, 'u1', { name: 'Sorted', description: 'by artist' })
    expect(client.calls[0]).toMatchObject({
      method: 'POST',
      path: '/users/u1/playlists',
      body: { name: 'Sorted', description: 'by artist', public: false },
    })
    expect(created.id).toBe('new1')
  })

  test('allows a public clone when explicitly asked', async () => {
    const client = recorder([{ id: 'new2' }])
    await createPlaylist(client, 'u1', { name: 'Sorted', isPublic: true })
    expect(client.calls[0].body.public).toBe(true)
  })
})
