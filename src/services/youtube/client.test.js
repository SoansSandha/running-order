import { describe, expect, test, vi } from 'vitest'
import { createYouTubeClient, ProxyUnavailableError, YouTubeSessionExpiredError } from './client.js'

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

  test('searches with the query, filter and limit encoded', async () => {
    const fetchImpl = vi.fn(async () => ok({ results: [{ videoId: 'v1' }] }))
    const results = await clientWith(fetchImpl).search('Don’t Worry Karan Aujla', 'songs', 5)
    expect(results).toEqual([{ videoId: 'v1' }])
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://127.0.0.1:8787/search?q=Don%E2%80%99t+Worry+Karan+Aujla&filter=songs&limit=5',
    )
  })

  test('a search with no results key is no results', async () => {
    expect(await clientWith(vi.fn(async () => ok({}))).search('x', 'videos', 3)).toEqual([])
  })

  test('looks up one video by id', async () => {
    const fetchImpl = vi.fn(async () => ok({ track: { videoId: 'q7e348rz27I' } }))
    expect(await clientWith(fetchImpl).track('q7e348rz27I')).toEqual({ videoId: 'q7e348rz27I' })
    expect(fetchImpl.mock.calls[0][0]).toBe('http://127.0.0.1:8787/track/q7e348rz27I')
  })

  test('a video YouTube does not have is null', async () => {
    expect(await clientWith(vi.fn(async () => ok({ track: null }))).track('aaaaaaaaaaa')).toBeNull()
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

  test('reports an expired YouTube session as its own error, saying what to do', async () => {
    // The proxy answers 401 when the library comes back empty and its live
    // probe fails. Without this the screen says the account has no playlists.
    const client = clientWith(vi.fn(async () => ({
      ok: false, status: 401, json: async () => ({ detail: 'YouTube Music session expired.' }),
    })))
    const failure = await client.listPlaylists().catch((error) => error)
    expect(failure).toBeInstanceOf(YouTubeSessionExpiredError)
    expect(failure.message).toMatch(/expired/)
    expect(failure.message).toMatch(/ytmusicapi browser/)
  })
})
