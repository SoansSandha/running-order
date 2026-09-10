import { describe, expect, test, vi } from 'vitest'
import { ApiError, AuthError, RateLimitError, createClient } from './client.js'

function response(status, body = null, headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key) => lower[key.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => (body === null ? '' : JSON.stringify(body)),
  }
}

function harness({ responses = [], token = 'tok', refresh } = {}) {
  const queue = [...responses]
  const calls = []
  const sleeps = []
  const fetchMock = vi.fn(async (url, init) => {
    calls.push({ url, init })
    if (queue.length === 0) throw new Error(`unexpected request to ${url}`)
    return queue.shift()
  })
  const refreshMock = vi.fn(refresh ?? (async () => 'tok2'))
  const client = createClient({
    getAccessToken: () => token,
    refreshAccessToken: refreshMock,
    fetch: fetchMock,
    sleep: async (ms) => { sleeps.push(ms) },
  })
  return { client, calls, sleeps, fetchMock, refreshMock }
}

describe('request basics', () => {
  test('sends the access token as a bearer credential', async () => {
    const { client, calls } = harness({ responses: [response(200, { ok: true })] })
    await client.get('/me')
    expect(calls[0].init.headers.Authorization).toBe('Bearer tok')
  })

  test('resolves relative paths against the Spotify API base', async () => {
    const { client, calls } = harness({ responses: [response(200, {})] })
    await client.get('/me')
    expect(calls[0].url).toBe('https://api.spotify.com/v1/me')
  })

  test('appends query parameters, skipping undefined ones', async () => {
    const { client, calls } = harness({ responses: [response(200, {})] })
    await client.get('/playlists', { query: { limit: 50, offset: 0, fields: undefined } })
    expect(calls[0].url).toBe('https://api.spotify.com/v1/playlists?limit=50&offset=0')
  })

  test('returns parsed JSON', async () => {
    const { client } = harness({ responses: [response(200, { id: 'abc' })] })
    expect(await client.get('/me')).toEqual({ id: 'abc' })
  })

  test('returns null for an empty 204, which writes often are', async () => {
    const { client } = harness({ responses: [response(204)] })
    expect(await client.put('/playlists/x/tracks', { body: { uris: [] } })).toBe(null)
  })

  test('serializes a JSON body and declares its content type', async () => {
    const { client, calls } = harness({ responses: [response(200, {})] })
    await client.post('/playlists', { body: { name: 'Test' } })
    expect(calls[0].init.body).toBe('{"name":"Test"}')
    expect(calls[0].init.headers['Content-Type']).toBe('application/json')
  })
})

describe('rate limiting', () => {
  test('waits the number of seconds Retry-After asks for, then retries', async () => {
    const { client, sleeps, fetchMock } = harness({
      responses: [response(429, null, { 'Retry-After': '3' }), response(200, { ok: true })],
    })
    expect(await client.get('/me')).toEqual({ ok: true })
    expect(sleeps).toEqual([3000])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('falls back to a sane delay when Retry-After is missing', async () => {
    const { client, sleeps } = harness({ responses: [response(429), response(200, {})] })
    await client.get('/me')
    expect(sleeps[0]).toBeGreaterThan(0)
  })

  test('gives up with a RateLimitError once attempts are exhausted', async () => {
    const { client } = harness({
      responses: [response(429, null, { 'Retry-After': '1' }), response(429, null, { 'Retry-After': '1' }), response(429, null, { 'Retry-After': '1' })],
    })
    await expect(client.get('/me')).rejects.toBeInstanceOf(RateLimitError)
  })

  test('reports how long the caller was asked to wait', async () => {
    const { client } = harness({ responses: Array(3).fill(response(429, null, { 'Retry-After': '7' })) })
    await expect(client.get('/me')).rejects.toMatchObject({ retryAfterMs: 7000 })
  })
})

describe('expired tokens', () => {
  test('refreshes once and retries with the new token', async () => {
    const { client, calls, refreshMock } = harness({
      responses: [response(401), response(200, { ok: true })],
    })
    expect(await client.get('/me')).toEqual({ ok: true })
    expect(refreshMock).toHaveBeenCalledTimes(1)
    expect(calls[1].init.headers.Authorization).toBe('Bearer tok2')
  })

  test('surfaces AuthError rather than looping when the refresh does not help', async () => {
    const { client, refreshMock } = harness({ responses: [response(401), response(401)] })
    await expect(client.get('/me')).rejects.toBeInstanceOf(AuthError)
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  test('surfaces AuthError when the refresh itself fails', async () => {
    const { client } = harness({
      responses: [response(401)],
      refresh: async () => { throw new Error('refresh token rejected') },
    })
    await expect(client.get('/me')).rejects.toBeInstanceOf(AuthError)
  })
})

describe('server errors', () => {
  test('retries a 500 with a growing backoff', async () => {
    const { client, sleeps } = harness({
      responses: [response(500), response(500), response(200, { ok: true })],
    })
    expect(await client.get('/me')).toEqual({ ok: true })
    expect(sleeps).toHaveLength(2)
    expect(sleeps[1]).toBeGreaterThan(sleeps[0])
  })

  test('throws ApiError once retries are exhausted', async () => {
    const { client } = harness({ responses: [response(503), response(503), response(503)] })
    await expect(client.get('/me')).rejects.toBeInstanceOf(ApiError)
  })
})

describe('client errors', () => {
  test('does not retry a 400, because retrying cannot help', async () => {
    const { client, fetchMock } = harness({
      responses: [response(400, { error: { message: 'Invalid request' } })],
    })
    await expect(client.get('/me')).rejects.toBeInstanceOf(ApiError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('carries the status and Spotify message so the UI can explain itself', async () => {
    const { client } = harness({
      responses: [response(403, { error: { message: 'You cannot edit this playlist' } })],
    })
    await expect(client.get('/me')).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('You cannot edit this playlist'),
    })
  })
})
