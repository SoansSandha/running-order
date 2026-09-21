import { describe, expect, test, vi } from 'vitest'
import { makeTracks } from '../../test/factory.js'
import { createSpotifyWriter } from './writer.js'

function fakeClient() {
  const calls = []
  return {
    calls,
    put: vi.fn(async (path, options) => {
      calls.push({ method: 'PUT', path, body: options.body })
      return { snapshot_id: 'snap-next' }
    }),
    post: vi.fn(async (path, options) => {
      calls.push({ method: 'POST', path, body: options.body })
      return { id: 'new-playlist' }
    }),
  }
}

describe('createSpotifyWriter', () => {
  test('reorder sends the index form and returns the new snapshot id', async () => {
    const client = fakeClient()
    const writer = createSpotifyWriter(client)
    const revision = await writer.reorder(
      'p1',
      { rangeStart: 3, insertBefore: 0, rangeLength: 1, key: 'k3', beforeKey: 'k0' },
      'snap-0',
    )
    expect(revision).toBe('snap-next')
    expect(client.calls[0].body).toMatchObject({
      range_start: 3,
      insert_before: 0,
      range_length: 1,
      snapshot_id: 'snap-0',
    })
  })

  test('reorder ignores the neutral fields', async () => {
    const client = fakeClient()
    await createSpotifyWriter(client).reorder(
      'p1',
      { rangeStart: 1, insertBefore: 4, rangeLength: 1, key: 'k1', beforeKey: null },
      'snap-0',
    )
    expect(client.calls[0].body).not.toHaveProperty('key')
    expect(client.calls[0].body).not.toHaveProperty('beforeKey')
  })

  test('addTracks maps Tracks to URIs before sending', async () => {
    const client = fakeClient()
    const tracks = makeTracks([{ name: 'one' }, { name: 'two' }])
    await createSpotifyWriter(client).addTracks('p1', tracks, {})
    expect(client.calls[0].body.uris).toEqual(tracks.map((t) => t.uri))
  })

  test('createPlaylist returns the created playlist', async () => {
    const client = fakeClient()
    const playlist = await createSpotifyWriter(client).createPlaylist('user-1', {
      name: 'Sorted',
      description: 'd',
      isPublic: false,
    })
    expect(playlist).toEqual({ id: 'new-playlist' })
  })
})
