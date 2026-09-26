import { describe, expect, test, vi } from 'vitest'
import { createYouTubeClient, ProxyUnavailableError } from './client.js'

const ok = (body) => ({ ok: true, status: 200, json: async () => body })

function clientWith(fetchImpl) {
  return createYouTubeClient({ baseUrl: 'http://127.0.0.1:8787', fetch: fetchImpl })
}

describe('createYouTubeClient', () => {
  test('reports authentication state', async () => {
    const client = clientWith(vi.fn(async () => ok({ authenticated: true })))
    expect(await client.authStatus()).toBe(true)
  })

  test('authStatus is false when the proxy is not running', async () => {
    // A dead proxy must not break Spotify-only use, so this cannot throw.
    const client = clientWith(vi.fn(async () => { throw new TypeError('fetch failed') }))
    expect(await client.authStatus()).toBe(false)
  })

  test('lists playlists', async () => {
    const fetchImpl = vi.fn(async () => ok({ playlists: [{ id: 'PL1', title: 'x', count: 3 }] }))
    const client = clientWith(fetchImpl)
    expect(await client.listPlaylists()).toEqual([{ id: 'PL1', title: 'x', count: 3 }])
    expect(fetchImpl.mock.calls[0][0]).toBe('http://127.0.0.1:8787/playlists')
  })

  test('fetches a playlist and keeps both counts', async () => {
    const client = clientWith(vi.fn(async () =>
      ok({ id: 'PL1', title: 'x', counted: 382, readable: 379, tracks: [{ videoId: 'v' }] }),
    ))
    const result = await client.fetchPlaylist('PL1')
    expect(result.counted).toBe(382)
    expect(result.readable).toBe(379)
    expect(result.tracks).toHaveLength(1)
  })

  test('encodes the playlist id into the path', async () => {
    const fetchImpl = vi.fn(async () => ok({ tracks: [] }))
    await clientWith(fetchImpl).fetchPlaylist('PL/weird id')
    expect(fetchImpl.mock.calls[0][0]).toBe('http://127.0.0.1:8787/playlists/PL%2Fweird%20id')
  })

  test('throws ProxyUnavailableError when the proxy cannot be reached', async () => {
    const client = clientWith(vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(client.listPlaylists()).rejects.toBeInstanceOf(ProxyUnavailableError)
  })

  test('surfaces an HTTP error distinctly from an unreachable proxy', async () => {
    const client = clientWith(vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
    const failure = await client.listPlaylists().catch((error) => error)
    expect(failure).not.toBeInstanceOf(ProxyUnavailableError)
    expect(failure.message).toMatch(/500/)
  })
})
