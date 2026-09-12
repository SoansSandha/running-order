import { describe, expect, test, vi } from 'vitest'
import {
  SCOPES,
  buildAuthorizeUrl,
  describeOriginProblem,
  exchangeCodeForTokens,
  refreshTokens,
} from './spotifyAuth.js'

const tokenResponse = (body, ok = true) => ({
  ok,
  status: ok ? 200 : 400,
  json: async () => body,
  text: async () => JSON.stringify(body),
})

describe('buildAuthorizeUrl', () => {
  const url = () =>
    new URL(
      buildAuthorizeUrl({
        clientId: 'cid',
        redirectUri: 'http://127.0.0.1:5173/',
        codeChallenge: 'chal',
        state: 'st',
      }),
    )

  test('points at the Spotify consent screen', () => {
    expect(url().origin + url().pathname).toBe('https://accounts.spotify.com/authorize')
  })

  test('requests the authorization code flow with S256 proof', () => {
    const params = url().searchParams
    expect(params.get('response_type')).toBe('code')
    expect(params.get('code_challenge_method')).toBe('S256')
    expect(params.get('code_challenge')).toBe('chal')
  })

  test('carries the client id, redirect and state', () => {
    const params = url().searchParams
    expect(params.get('client_id')).toBe('cid')
    expect(params.get('redirect_uri')).toBe('http://127.0.0.1:5173/')
    expect(params.get('state')).toBe('st')
  })

  test('asks for exactly the four playlist scopes the app needs', () => {
    expect(url().searchParams.get('scope').split(' ').sort()).toEqual([
      'playlist-modify-private',
      'playlist-modify-public',
      'playlist-read-collaborative',
      'playlist-read-private',
    ])
  })

  test('never requests a scope the app does not use', () => {
    expect(SCOPES).not.toContain('user-read-email')
    expect(SCOPES).not.toContain('ugc-image-upload')
  })
})

describe('describeOriginProblem', () => {
  // Spotify allows http only for loopback IP literals. A hostname that merely
  // resolves to one is refused, and it is refused on Spotify's own error page
  // where this app never gets to explain — so the app has to catch it first.
  const at = (hostname, port = '', protocol = 'http:') => ({ hostname, port, protocol })

  test('accepts the loopback literal', () => {
    expect(describeOriginProblem(at('127.0.0.1', '5173'))).toBe(null)
  })

  test('accepts the IPv6 loopback literal', () => {
    expect(describeOriginProblem(at('[::1]', '5173'))).toBe(null)
  })

  test('accepts any https host', () => {
    expect(describeOriginProblem(at('sorter.example.com', '', 'https:'))).toBe(null)
  })

  test('rejects localhost, naming the address to use instead', () => {
    expect(describeOriginProblem(at('localhost', '5173'))).toMatch(/127\.0\.0\.1:5173/)
  })

  test('rejects a plain http host that is not loopback', () => {
    expect(describeOriginProblem(at('example.com'))).toBeTruthy()
  })
})

describe('exchangeCodeForTokens', () => {
  test('posts the verifier as form data, with no client secret', async () => {
    const fetchMock = vi.fn(async () =>
      tokenResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }),
    )
    await exchangeCodeForTokens(
      { clientId: 'cid', code: 'code123', redirectUri: 'http://127.0.0.1:5173/', codeVerifier: 'ver' },
      { fetch: fetchMock },
    )
    const [url, init] = fetchMock.mock.calls[0]
    const body = new URLSearchParams(init.body)
    expect(url).toBe('https://accounts.spotify.com/api/token')
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code_verifier')).toBe('ver')
    expect(body.get('client_id')).toBe('cid')
    expect(body.get('client_secret')).toBe(null)
  })

  test('returns tokens with an absolute expiry rather than a duration', async () => {
    const fetchMock = vi.fn(async () =>
      tokenResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }),
    )
    const before = Date.now()
    const tokens = await exchangeCodeForTokens(
      { clientId: 'cid', code: 'c', redirectUri: 'r', codeVerifier: 'v' },
      { fetch: fetchMock },
    )
    expect(tokens.accessToken).toBe('at')
    expect(tokens.refreshToken).toBe('rt')
    expect(tokens.expiresAt).toBeGreaterThan(before)
  })

  test('surfaces the reason Spotify rejected the exchange', async () => {
    const fetchMock = vi.fn(async () =>
      tokenResponse({ error: 'invalid_grant', error_description: 'Invalid redirect URI' }, false),
    )
    await expect(
      exchangeCodeForTokens({ clientId: 'c', code: 'c', redirectUri: 'r', codeVerifier: 'v' }, { fetch: fetchMock }),
    ).rejects.toThrow(/Invalid redirect URI/)
  })
})

describe('refreshTokens', () => {
  test('sends the refresh grant with the client id', async () => {
    const fetchMock = vi.fn(async () => tokenResponse({ access_token: 'at2', expires_in: 3600 }))
    await refreshTokens({ clientId: 'cid', refreshToken: 'rt' }, { fetch: fetchMock })
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body)
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('rt')
    expect(body.get('client_id')).toBe('cid')
  })

  test('keeps the rotated refresh token when Spotify sends a new one', async () => {
    // Spotify rotates refresh tokens. Dropping the new one makes the app fail
    // silently about an hour later.
    const fetchMock = vi.fn(async () =>
      tokenResponse({ access_token: 'at2', refresh_token: 'rt2', expires_in: 3600 }),
    )
    const tokens = await refreshTokens({ clientId: 'c', refreshToken: 'rt1' }, { fetch: fetchMock })
    expect(tokens.refreshToken).toBe('rt2')
  })

  test('retains the previous refresh token when the response omits one', async () => {
    const fetchMock = vi.fn(async () => tokenResponse({ access_token: 'at2', expires_in: 3600 }))
    const tokens = await refreshTokens({ clientId: 'c', refreshToken: 'rt1' }, { fetch: fetchMock })
    expect(tokens.refreshToken).toBe('rt1')
  })
})
