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
      path: '/playlists/p1/items',
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
    expect(client.calls[0].path).toBe('/playlists/p1/items')
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
  /** A client that rejects the first N posts with a given status. */
  function rejecting(status, rejectPaths) {
    const calls = []
    return {
      calls,
      post: vi.fn(async (path, options) => {
        calls.push({ method: 'POST', path, ...options })
        if (rejectPaths.includes(path)) {
          const error = new Error('Forbidden')
          error.status = status
          throw error
        }
        return { id: 'created' }
      }),
    }
  }

  test('creates a private playlist on the me endpoint', async () => {
    const client = recorder([{ id: 'new1' }])
    const created = await createPlaylist(client, 'u1', { name: 'Sorted', description: 'by artist' })
    expect(client.calls[0]).toMatchObject({
      method: 'POST',
      path: '/me/playlists',
      body: { name: 'Sorted', description: 'by artist', public: false },
    })
    expect(created.id).toBe('new1')
  })

  test('allows a public clone when explicitly asked', async () => {
    const client = recorder([{ id: 'new2' }])
    await createPlaylist(client, 'u1', { name: 'Sorted', isPublic: true })
    expect(client.calls[0].body.public).toBe(true)
  })

  test('falls back to the user endpoint when the me endpoint refuses it', async () => {
    // Spotify has been moving this surface; rather than bet on one path, try
    // the other before giving up. Which one answered is visible in the log.
    const client = rejecting(403, ['/me/playlists'])
    const created = await createPlaylist(client, 'u1', { name: 'Sorted' })
    expect(client.calls.map((call) => call.path)).toEqual([
      '/me/playlists',
      '/users/u1/playlists',
    ])
    expect(created.id).toBe('created')
  })

  test('does not retry an error that is not about the endpoint', async () => {
    const client = rejecting(401, ['/me/playlists', '/users/u1/playlists'])
    await expect(createPlaylist(client, 'u1', { name: 'Sorted' })).rejects.toThrow()
    expect(client.calls).toHaveLength(1)
  })

  test('surfaces the original failure when both endpoints refuse', async () => {
    const client = rejecting(403, ['/me/playlists', '/users/u1/playlists'])
    await expect(createPlaylist(client, 'u1', { name: 'Sorted' })).rejects.toThrow()
    expect(client.calls).toHaveLength(2)
  })
})
