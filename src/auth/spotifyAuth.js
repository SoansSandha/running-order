/**
 * The OAuth handshake and token lifecycle.
 *
 * See docs design §5.3. The redirect URI is the app root, so the callback
 * needs no route: the app checks for `?code=` on load and clears it.
 */

const AUTHORIZE_ENDPOINT = 'https://accounts.spotify.com/authorize'
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token'

/** Exactly what the app needs, and nothing more. */
export const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
]

/** The app root — this exact string must be registered in the dashboard. */
export function currentRedirectUri() {
  return `${window.location.origin}/`
}

export function buildAuthorizeUrl({ clientId, redirectUri, codeChallenge, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    state,
    scope: SCOPES.join(' '),
  })
  return `${AUTHORIZE_ENDPOINT}?${params}`
}

export async function exchangeCodeForTokens(
  { clientId, code, redirectUri, codeVerifier },
  { fetch: fetchImpl = globalThis.fetch } = {},
) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  })
  return postForm(fetchImpl, body, null)
}

export async function refreshTokens(
  { clientId, refreshToken },
  { fetch: fetchImpl = globalThis.fetch } = {},
) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  })
  return postForm(fetchImpl, body, refreshToken)
}

async function postForm(fetchImpl, body, previousRefreshToken) {
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(
      payload?.error_description || payload?.error || `Token request failed (${response.status})`,
    )
  }

  return {
    accessToken: payload.access_token,
    // Spotify rotates refresh tokens. Falling back to the previous one keeps
    // the session alive when a refresh response omits a new token.
    refreshToken: payload.refresh_token ?? previousRefreshToken ?? null,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    scope: payload.scope ?? '',
  }
}
