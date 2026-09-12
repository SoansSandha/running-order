/**
 * The Spotify HTTP client: bearer injection, typed errors, and the retry
 * behaviour every call in the app depends on.
 *
 * See docs design §5.4 and §11.
 *
 * `fetch` and `sleep` are injected so the retry logic can be tested without a
 * network or a real clock.
 */

const API_BASE = 'https://api.spotify.com/v1'
const DEFAULT_RETRY_MS = 1000
const BACKOFF_BASE_MS = 500
const MAX_ATTEMPTS = 3

export class ApiError extends Error {
  constructor(message, { status = 0, body = null, url = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
    this.url = url
  }
}

/** The session is gone. The UI must send the user back to Connect. */
export class AuthError extends ApiError {
  constructor(message, options) {
    super(message, options)
    this.name = 'AuthError'
  }
}

/** Spotify is throttling us. Carries how long it asked us to wait. */
export class RateLimitError extends ApiError {
  constructor(message, options = {}) {
    super(message, options)
    this.name = 'RateLimitError'
    this.retryAfterMs = options.retryAfterMs ?? DEFAULT_RETRY_MS
  }
}

export function createClient({
  getAccessToken,
  refreshAccessToken,
  fetch: fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxAttempts = MAX_ATTEMPTS,
  onEvent,
}) {
  async function request(path, { method = 'GET', body, query, signal } = {}) {
    const url = buildUrl(path, query)
    // Scoped to this request: a refresh mid-flight must not leave a stale
    // token cached on the client.
    let token = null
    let refreshed = false
    let attempt = 0

    for (;;) {
      attempt += 1

      const headers = { Authorization: `Bearer ${token ?? getAccessToken()}` }
      if (body !== undefined) headers['Content-Type'] = 'application/json'

      const response = await fetchImpl(url, {
        method,
        headers,
        signal,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })

      if (response.ok) {
        const payload = await parseBody(response)
        onEvent?.({ url, method, status: response.status, body: payload })
        return payload
      }

      if (response.status === 401) {
        if (refreshed) {
          throw new AuthError('Your Spotify session expired. Please connect again.', { status: 401 })
        }
        refreshed = true
        attempt -= 1 // a refresh is not a failed attempt
        try {
          const fresh = await refreshAccessToken()
          if (typeof fresh === 'string' && fresh) token = fresh
        } catch {
          throw new AuthError('Your Spotify session expired. Please connect again.', { status: 401 })
        }
        continue
      }

      if (response.status === 429) {
        const retryAfterMs = readRetryAfter(response)
        if (attempt >= maxAttempts) {
          throw new RateLimitError('Spotify is rate limiting this app. Try again shortly.', {
            status: 429,
            retryAfterMs,
          })
        }
        await sleep(retryAfterMs)
        continue
      }

      if (response.status >= 500) {
        if (attempt >= maxAttempts) {
          throw new ApiError(`Spotify is having trouble (${response.status}). Try again shortly.`, {
            status: response.status,
          })
        }
        await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1))
        continue
      }

      // 4xx other than 401/429: retrying cannot help.
      const errorBody = await parseBody(response)
      onEvent?.({ url, method, status: response.status, body: errorBody })
      throw new ApiError(describe(errorBody, response.status), {
        status: response.status,
        body: errorBody,
        url,
      })
    }
  }

  return {
    request,
    get: (path, options) => request(path, { ...options, method: 'GET' }),
    post: (path, options) => request(path, { ...options, method: 'POST' }),
    put: (path, options) => request(path, { ...options, method: 'PUT' }),
    delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
  }
}

function buildUrl(path, query) {
  const base = path.startsWith('http') ? path : `${API_BASE}${path}`
  if (!query) return base
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.append(key, String(value))
  }
  const search = params.toString()
  return search ? `${base}?${search}` : base
}

async function parseBody(response) {
  if (response.status === 204) return null
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function readRetryAfter(response) {
  const header = response.headers?.get?.('Retry-After')
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RETRY_MS
}

function describe(body, status) {
  const reason = body?.error?.message ?? body?.error_description
  return reason ? `${reason} (${status})` : `Spotify request failed (${status})`
}
