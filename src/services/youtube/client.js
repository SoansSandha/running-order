/**
 * Talks to the local YouTube proxy.
 *
 * The proxy is an ordinary HTTP API that happens to run on this machine, so
 * this is a plain fetch wrapper. It holds no YouTube knowledge beyond the
 * route shapes — normalization lives in ./track.js.
 */

const DEFAULT_BASE_URL = 'http://127.0.0.1:8787'

/** The proxy process is not running or not reachable. */
export class ProxyUnavailableError extends Error {
  constructor(cause) {
    super(
      'The YouTube proxy is not running. `npm start` runs it alongside the ' +
        'app, or `npm run dev:proxy` runs it alone.',
      { cause },
    )
    this.name = 'ProxyUnavailableError'
  }
}

export function createYouTubeClient({ baseUrl = DEFAULT_BASE_URL, fetch: fetchImpl = globalThis.fetch } = {}) {
  async function request(path) {
    let response
    try {
      response = await fetchImpl(`${baseUrl}${path}`)
    } catch (cause) {
      // A refused connection is a different problem from a failing request,
      // and the user can act on it, so it keeps its own type.
      throw new ProxyUnavailableError(cause)
    }
    if (!response.ok) {
      throw new Error(`YouTube proxy returned ${response.status} for ${path}`)
    }
    return response.json()
  }

  return {
    /**
     * Whether stored credentials load. Answers false rather than throwing when
     * the proxy is absent: Spotify-only use must not depend on it (spec §5).
     */
    async authStatus() {
      try {
        const body = await request('/auth/status')
        return body?.authenticated === true
      } catch {
        return false
      }
    },

    async listPlaylists() {
      const body = await request('/playlists')
      return body?.playlists ?? []
    },

    /** @returns {Promise<{id, title, counted, readable, tracks}>} */
    fetchPlaylist(playlistId) {
      return request(`/playlists/${encodeURIComponent(playlistId)}`)
    },
  }
}
