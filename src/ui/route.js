/**
 * Which screen the URL names, and how to move to another.
 *
 * The URL owns the screen, the library being browsed and the open playlist
 * (D41); everything else stays in useSorterApp. One pattern covers every
 * screen, so this is a few lines over the History API rather than a router
 * library (D42). See docs/2026-10-11-routes-design.md §3–4.
 */

import { useCallback, useEffect, useState } from 'react'

const SOURCES = new Set(['spotify', 'youtube'])
const VIEWS = new Set(['preview', 'progress', 'review'])

/**
 * Spotify and YouTube ids are letters, digits, `_` and `-`. Anything else is
 * refused here, so a pasted URL can never put `/`, `..` or `%` into an API
 * path.
 */
const ID = /^[\w-]+$/

const HOME = { view: 'home', source: 'spotify', playlistId: null }

/**
 * @param {{pathname: string, search?: string}} location
 * @returns {{view: string, source: string, playlistId: string|null} | {redirect: string}}
 */
export function parseRoute({ pathname, search = '' }) {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 0) {
    const source = new URLSearchParams(search).get('source') === 'youtube' ? 'youtube' : 'spotify'
    return { view: 'home', source, playlistId: null }
  }

  const [source, playlistId = '', view, ...extra] = parts
  if (
    !SOURCES.has(source) ||
    !ID.test(playlistId) ||
    (view !== undefined && !VIEWS.has(view)) ||
    extra.length > 0
  ) {
    return { redirect: pathFor(HOME, search) }
  }
  // Review starts from a Spotify playlist; Sort offers it nowhere else.
  if (view === 'review' && source !== 'spotify') {
    return { redirect: pathFor({ view: 'sort', source, playlistId }, search) }
  }
  return { view: view ?? 'sort', source, playlistId }
}

/** The path for a route. Every query parameter but `source` is carried. */
export function pathFor({ view, source, playlistId }, search = '') {
  const params = new URLSearchParams(search)
  params.delete('source')
  let path = '/'
  if (view === 'home') {
    if (source === 'youtube') params.set('source', 'youtube')
  } else {
    path = `/${source}/${playlistId}${view === 'sort' ? '' : `/${view}`}`
  }
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

/** The route the address bar names, after any redirect it calls for. */
function readRoute() {
  const route = parseRoute(window.location)
  if (!route.redirect) return route
  window.history.replaceState(null, '', route.redirect)
  return parseRoute(window.location)
}

/**
 * The current route, and `navigate(route, { replace })` to move to another.
 *
 * `navigate` takes a route rather than a path and reads the query from the
 * address bar when it is called. useAuth clears `?code=` with its own
 * replaceState, and a query remembered from before that would carry the
 * spent sign-in code onto the next screen.
 */
export function useRoute() {
  const [route, setRoute] = useState(readRoute)

  useEffect(() => {
    const onPop = () => setRoute(readRoute())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((next, { replace = false } = {}) => {
    const path = pathFor(next, window.location.search)
    // Re-asserting the screen already shown must not stack a duplicate
    // entry for back to step through.
    if (path !== window.location.pathname + window.location.search) {
      if (replace) window.history.replaceState(null, '', path)
      else window.history.pushState(null, '', path)
    }
    setRoute(readRoute())
  }, [])

  return [route, navigate]
}
