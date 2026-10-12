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

/**
 * The proxy is running, but YouTube no longer accepts its stored session.
 * The proxy reports this as a 401; it would otherwise reach the user as an
 * empty library.
 */
export class YouTubeSessionExpiredError extends Error {
  constructor() {
    super(
      'Your YouTube Music session has expired. Capture fresh credentials with ' +
        '`ytmusicapi browser` (see proxy/README.md), copy browser.json into ' +
        'proxy/, then reload.',
    )
    this.name = 'YouTubeSessionExpiredError'
  }
}

/**
 * YouTube Music refused a change: an addition, a move or a removal. The
 * proxy reports it as a 409. For an addition it means nothing in that
 * request was added (mirror run design §3).
 */
export class YouTubeRefusedError extends Error {
  constructor(detail) {
    super(detail || 'YouTube Music refused the change.')
    this.name = 'YouTubeRefusedError'
    // For an addition, the proxy's 409 means nothing in that request was
    // added (`duplicates=False`). The mirror run reads this property rather
    // than this class, so src/plan/ imports nothing from here.
    this.nothingAdded = true
  }
}

/** The proxy's own `detail`, or null when the body carries none. */
const detailOf = (response) => response.json().then((answer) => answer?.detail, () => null)

export function createYouTubeClient({ baseUrl = DEFAULT_BASE_URL, fetch: fetchImpl = globalThis.fetch } = {}) {
  async function request(path, { method = 'GET', body } = {}) {
    // A write carries JSON: the proxy reads a body only as JSON (D48).
    const init =
      method === 'GET'
        ? undefined
        : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    let response
    try {
      response = await fetchImpl(`${baseUrl}${path}`, init)
    } catch (cause) {
      // A refused connection is a different problem from a failing request,
      // and the user can act on it, so it keeps its own type.
      throw new ProxyUnavailableError(cause)
    }
    if (response.status === 401) throw new YouTubeSessionExpiredError()
    if (response.status === 409) throw new YouTubeRefusedError(await detailOf(response))
    if (!response.ok) {
      // A 502 says what failed ("Could not reach YouTube Music."). A 422's
      // detail is a list, not a sentence, so only a string is passed on.
      const detail = await detailOf(response)
      const said = typeof detail === 'string' ? `: ${detail}` : ''
      throw new Error(`YouTube proxy returned ${response.status} for ${path}${said}`)
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

    /**
     * Catalogue search, results passed through as ytmusicapi returns them.
     * @param {'songs'|'videos'} filter
     */
    async search(query, filter, limit) {
      const params = new URLSearchParams({ q: query, filter, limit: String(limit) })
      const body = await request(`/search?${params}`)
      return body?.results ?? []
    },

    /** One video as a track, or null when YouTube has no such video. */
    async track(videoId) {
      const body = await request(`/track/${encodeURIComponent(videoId)}`)
      return body?.track ?? null
    },

    /** Add videos in this order, and answer the item id each was given (mirror run design §3). */
    async addItems(playlistId, videoIds) {
      const body = await request(`/playlists/${encodeURIComponent(playlistId)}/items`, {
        method: 'POST',
        body: { videoIds },
      })
      return body?.added ?? []
    },

    /** Move one item before another; a null `beforeSetVideoId` moves it to the end. */
    async moveItem(playlistId, setVideoId, beforeSetVideoId) {
      await request(`/playlists/${encodeURIComponent(playlistId)}/order`, {
        method: 'PATCH',
        body: { setVideoId, beforeSetVideoId },
      })
    },

    /** Remove playlist items, each named by its videoId and setVideoId. */
    async removeItems(playlistId, items) {
      await request(`/playlists/${encodeURIComponent(playlistId)}/items`, {
        method: 'DELETE',
        body: { items },
      })
    },
  }
}
