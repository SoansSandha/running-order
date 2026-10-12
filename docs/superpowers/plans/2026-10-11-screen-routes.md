# Screen Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every screen gets its own URL, `/` stays home, back and forward move between screens, and a refresh reopens what it can.

**Architecture:**
- **A small router in one file,** `src/ui/route.js`: two pure functions (`parseRoute`, `pathFor`) and a `useRoute()` hook over `pushState`, `replaceState` and `popstate`. No router library.
- **The URL owns** which screen shows, which library is browsed and which playlist is open. `useSorterApp` drops its `screen` state, derives `source` from the route, and keeps `setScreen` as a function that navigates, so the screens do not change.
- **One sync step** (an effect in `useSorterApp`) loads a playlist the URL names by id when memory does not hold it, sends a cold Preview or Progress to Sort, holds the URL on Progress while a write runs, and resets state when the URL's source changes.

**Tech Stack:** React 19 (JavaScript, not TypeScript), Vite 8, Vitest 3 (node environment, no DOM), Oxlint, and `playwright-cli` (installed globally) for browser checks.

**Spec:** [docs/2026-10-11-routes-design.md](../../2026-10-11-routes-design.md). Read it in full before starting. Decisions D41–D47 are referred to by number below.

## Global Constraints

- **No new dependencies.** `package.json` and `proxy/requirements.txt` do not change.
- **Sign-in is unchanged.** `src/auth/useAuth.js` and `currentRedirectUri()` (still `${origin}/`) are not touched (D45).
- **Screens:** Connect, Playlists, Sort, Preview, Progress and `MatchTray.jsx` are not changed. `Review.jsx` changes only as Task 3 says.
- **Routes, exactly as spec §3:** `/`, `/?source=youtube`, `/:source/:id`, `/:source/:id/preview`, `/:source/:id/progress`, `/spotify/:id/review`. `:source` is `spotify` or `youtube`. An id matches `/^[\w-]+$/`.
- **Copy, verbatim:**
  - "This account has no playlist at that address." (a URL names a playlist that cannot be found)
  - "Reading the playlist" (the meter label while a playlist named only by the URL is read)
  - "Could not read this playlist" (Review's error notice title, the same as Sort's)
- **Lint:** `npm run lint` reports exactly two warnings, in `src/ui/components/Flap.jsx` and `src/auth/useAuth.js`, and no others. The one permitted suppression is in Task 3, with its text given there.
- **Git (CLAUDE.md):**
  - Stage, never commit, push or merge.
  - `git add` explicit paths only, never `git add -A` or `git add .`.
  - Never stage `proxy/browser.json`, `.env*`, `.local/` or `.playwright-cli/`.
- **Commands,** from the repo root:
  - `npm test`: 699 tests pass before this plan, 727 after Task 1, and 732 after Task 2.
  - `npm run lint` and `npm run build`.
- **The dev server** must be served at `http://127.0.0.1:5173`.
  - If something already answers there, use it and leave it running. It may be the owner's.
  - Otherwise start it in the background (`npm run dev:web` for demo mode, `npm run dev` when the YouTube proxy is needed), and stop it when done.
- **Live testing** uses only "test punjabi songs" on the owner's test profiles. Never open, sort or change any other playlist.

## Review Focus

The ways this most likely breaks for a real person, each pinned where it is owned:

1. **A pasted URL whose id holds `/`, `..`, `%` or anything but letters, digits, `_` and `-`** must land on `/` before anything is fetched, never reach a Spotify API path. Pinned in Task 1 (`an encoded slash in the id`, `a dot in the id`) and Task 3 (the demo check's `badId`).
2. **The spent sign-in code must not ride onto the next screen.** useAuth clears `?code=` with its own `replaceState`; a navigation that reused an older query would put it back, and the next refresh would fail with "That sign-in did not match". Pinned in Task 5 (the URL after signing in and opening a playlist carries no `code=` or `state=`).
3. **Review refreshed before the Spotify side is read** must not let a YouTube playlist be chosen, or it is scored against no Spotify tracks at all. Pinned in Task 5 (refresh on Review: "Match against" is disabled while the reading meter shows).
4. **Back pressed while a write runs** must keep Progress on screen, so no Preview lever can start a second write. Pinned in Task 3 (the demo check's `pinned` and `pinnedBack`).
5. **Leaving a library with back or forward** must reset strategy and options exactly as the toggle does, so a strategy YouTube cannot run is never left pressed and disabled. Pinned in Task 5 (Popularity chosen on Spotify, then the YouTube copy opened).

---

### Task 1: The router

**Files:**
- Create: `src/ui/route.js`
- Test: `src/ui/route.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parseRoute({ pathname, search = '' })` → `{ view, source, playlistId }` or `{ redirect }`.
    - `view`: `'home' | 'sort' | 'preview' | 'progress' | 'review'`.
    - `source`: `'spotify' | 'youtube'`.
    - `playlistId`: a string, or `null` on home.
    - `redirect`: the path to replace the address with.
  - `pathFor(route, search = '')` → string, the path for a route. Every query parameter in `search` except `source` is carried.
  - `useRoute()` → `[route, navigate]`.
    - `route` is never a redirect.
    - `navigate(route, { replace = false } = {})` pushes the route (or replaces the current entry), reading the query from the address bar at the moment it is called.

- [ ] **Step 1: Write the failing tests**

Create `src/ui/route.test.js`:

```js
import { describe, expect, test } from 'vitest'
import { parseRoute, pathFor } from './route.js'

const at = (path) => parseRoute(new URL(path, 'http://127.0.0.1:5173'))

describe('parseRoute', () => {
  test('/ is the Spotify library', () => {
    expect(at('/')).toEqual({ view: 'home', source: 'spotify', playlistId: null })
  })

  test('?source=youtube is the YouTube library', () => {
    expect(at('/?source=youtube')).toEqual({ view: 'home', source: 'youtube', playlistId: null })
  })

  test('an unknown ?source is the Spotify library', () => {
    expect(at('/?source=tidal')).toEqual({ view: 'home', source: 'spotify', playlistId: null })
  })

  test('a playlist path is its Sort screen', () => {
    expect(at('/spotify/37i9dQZF1DXcBWIGoYBM5M')).toEqual({
      view: 'sort',
      source: 'spotify',
      playlistId: '37i9dQZF1DXcBWIGoYBM5M',
    })
  })

  test('a trailing slash is the same route', () => {
    expect(at('/youtube/PLx_y-1/')).toEqual({ view: 'sort', source: 'youtube', playlistId: 'PLx_y-1' })
  })

  test.each(['preview', 'progress', 'review'])('/spotify/:id/%s is that view', (view) => {
    expect(at(`/spotify/abc/${view}`)).toEqual({ view, source: 'spotify', playlistId: 'abc' })
  })

  test('a YouTube playlist has no Review, so it lands on its Sort', () => {
    expect(at('/youtube/PLabc/review?demo=1')).toEqual({ redirect: '/youtube/PLabc?demo=1' })
  })

  test.each([
    ['an unknown source', '/tidal/abc'],
    ['a source with no id', '/spotify'],
    ['an unknown view', '/spotify/abc/settings'],
    ['Sort named outright', '/spotify/abc/sort'],
    ['extra segments', '/spotify/abc/preview/more'],
    ['an encoded slash in the id', '/spotify/a%2F..%2Fme'],
    ['a dot in the id', '/spotify/a.b'],
  ])('%s goes home', (_, path) => {
    expect(at(path)).toEqual({ redirect: '/' })
  })

  test('a redirect home keeps the other query parameters', () => {
    expect(at('/nowhere?demo=1&source=youtube')).toEqual({ redirect: '/?demo=1' })
  })
})

const ROUTES = [
  { view: 'home', source: 'spotify', playlistId: null },
  { view: 'home', source: 'youtube', playlistId: null },
  { view: 'sort', source: 'spotify', playlistId: 'abc' },
  { view: 'preview', source: 'spotify', playlistId: 'abc' },
  { view: 'progress', source: 'spotify', playlistId: 'abc' },
  { view: 'review', source: 'spotify', playlistId: 'abc' },
  { view: 'sort', source: 'youtube', playlistId: 'PL_a-b' },
  { view: 'preview', source: 'youtube', playlistId: 'PL_a-b' },
  { view: 'progress', source: 'youtube', playlistId: 'PL_a-b' },
]

describe('pathFor', () => {
  test.each(ROUTES)('$view on $source survives a round trip', (route) => {
    expect(at(pathFor(route))).toEqual(route)
  })

  test('names each path as the spec does', () => {
    expect(pathFor({ view: 'home', source: 'spotify', playlistId: null })).toBe('/')
    expect(pathFor({ view: 'home', source: 'youtube', playlistId: null })).toBe('/?source=youtube')
    expect(pathFor({ view: 'sort', source: 'spotify', playlistId: 'abc' })).toBe('/spotify/abc')
    expect(pathFor({ view: 'review', source: 'spotify', playlistId: 'abc' })).toBe('/spotify/abc/review')
  })

  test('carries other query parameters, and keeps ?source to home', () => {
    expect(pathFor({ view: 'preview', source: 'youtube', playlistId: 'PLx' }, '?demo=1&source=youtube&debug')).toBe(
      '/youtube/PLx/preview?demo=1&debug=',
    )
    expect(pathFor({ view: 'home', source: 'youtube', playlistId: null }, '?demo=1')).toBe('/?demo=1&source=youtube')
    expect(pathFor({ view: 'home', source: 'spotify', playlistId: null }, '?source=youtube')).toBe('/')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/route.test.js`
Expected: FAIL, "Failed to resolve import "./route.js"".

- [ ] **Step 3: Write the router**

Create `src/ui/route.js`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ui/route.test.js`
Expected: PASS, 28 tests.

Run: `npm test`
Expected: 727 tests pass.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: exactly the two existing warnings (Flap.jsx, useAuth.js).

- [ ] **Step 6: Stage**

```bash
git add src/ui/route.js src/ui/route.test.js
```

---

### Task 2: Reading one Spotify playlist by id

**Files:**
- Modify: `src/services/spotify/playlists.js` (the `TRACK_FIELDS` block near the top, and `listEditablePlaylists`)
- Test: `src/services/spotify/playlists.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `getPlaylist(client, playlistId, currentUserId)` → `Promise<row>`. The row has the same shape `listEditablePlaylists` returns for each playlist: `{ id, name, description, imageUrl, trackCount, owner: { id, displayName }, collaborative, isPublic, snapshotId, editable }`.

- [ ] **Step 1: Write the failing tests**

In `src/services/spotify/playlists.test.js`, change the import line to:

```js
import { fetchAllPages, fetchPlaylistTracks, getCurrentUser, getPlaylist, listEditablePlaylists } from './playlists.js'
```

Add this block after the `describe('listEditablePlaylists', …)` block:

```js
describe('getPlaylist', () => {
  test('builds the same row as the library does for the same playlist', async () => {
    const raw = playlist('p1', 'Mine', 'u1')
    const client = fakeClient({
      '/me/playlists': { items: [raw], next: null },
      '/playlists/p1': raw,
    })
    const [fromLibrary] = await listEditablePlaylists(client, 'u1')
    expect(await getPlaylist(client, 'p1', 'u1')).toEqual(fromLibrary)
  })

  test.each([
    ['an owned', playlist('p1', 'Mine', 'u1'), true],
    ['a collaborative', playlist('p3', 'Shared', 'someone', { collaborative: true }), true],
    ["someone else's", playlist('p2', 'Theirs', 'someone'), false],
  ])('works out access for %s playlist', async (_, raw, editable) => {
    const client = fakeClient({ [`/playlists/${raw.id}`]: raw })
    expect((await getPlaylist(client, raw.id, 'u1')).editable).toBe(editable)
  })

  test('asks for both track count names, and for no tracks', async () => {
    const client = fakeClient({ '/playlists/p1': playlist('p1', 'Mine', 'u1') })
    await getPlaylist(client, 'p1', 'u1')
    const { fields } = client.calls[0].options.query
    expect(fields).toContain('items.total')
    expect(fields).toContain('tracks.total')
    expect(fields).not.toContain('items(')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/spotify/playlists.test.js`
Expected: FAIL, the five `getPlaylist` tests with "getPlaylist is not a function".

- [ ] **Step 3: Implement**

In `src/services/spotify/playlists.js`, directly after the `TRACK_FIELDS` constant, add:

```js
/**
 * What a library row reads from one playlist. Both count names are asked
 * for, as above; without a projection the reply would carry its first
 * hundred tracks too.
 */
const PLAYLIST_FIELDS =
  'id,name,description,images(url),owner(id,display_name),collaborative,public,snapshot_id,' +
  'items.total,tracks.total'
```

Replace the whole of `listEditablePlaylists`:

```js
export async function listEditablePlaylists(client, currentUserId, { onProgress } = {}) {
  const raw = await fetchAllPages(client, '/me/playlists', {
    query: { limit: PLAYLIST_PAGE_SIZE },
    onProgress,
  })

  return raw.filter(Boolean).map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description ?? '',
    imageUrl: item.images?.[0]?.url ?? null,
    trackCount: playlistTrackCount(item),
    owner: { id: item.owner?.id ?? null, displayName: item.owner?.display_name || item.owner?.id || '' },
    collaborative: item.collaborative === true,
    isPublic: item.public === true,
    snapshotId: item.snapshot_id ?? null,
    editable: item.owner?.id === currentUserId || item.collaborative === true,
  }))
}
```

with:

```js
export async function listEditablePlaylists(client, currentUserId, { onProgress } = {}) {
  const raw = await fetchAllPages(client, '/me/playlists', {
    query: { limit: PLAYLIST_PAGE_SIZE },
    onProgress,
  })

  return raw.filter(Boolean).map((item) => toPlaylist(item, currentUserId))
}

/**
 * One playlist, as the row the library would list for it. A URL can name a
 * playlist the library has not been read for (routes design §5).
 */
export async function getPlaylist(client, playlistId, currentUserId) {
  const item = await client.get(`/playlists/${playlistId}`, {
    query: { fields: projectionEnabled ? PLAYLIST_FIELDS : undefined },
  })
  return toPlaylist(item, currentUserId)
}

/** A playlist as the app's row, flagged with whether we may write to it. */
function toPlaylist(item, currentUserId) {
  return {
    id: item.id,
    name: item.name,
    description: item.description ?? '',
    imageUrl: item.images?.[0]?.url ?? null,
    trackCount: playlistTrackCount(item),
    owner: { id: item.owner?.id ?? null, displayName: item.owner?.display_name || item.owner?.id || '' },
    collaborative: item.collaborative === true,
    isPublic: item.public === true,
    snapshotId: item.snapshot_id ?? null,
    editable: item.owner?.id === currentUserId || item.collaborative === true,
  }
}
```

The id needs no encoding here: Task 1 admits only `/^[\w-]+$/` from a URL, and board rows come from Spotify.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/spotify/playlists.test.js`
Expected: PASS, including every existing `listEditablePlaylists` test unchanged.

Run: `npm test`
Expected: 732 tests pass.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: exactly the two existing warnings.

- [ ] **Step 6: Stage**

```bash
git add src/services/spotify/playlists.js src/services/spotify/playlists.test.js
```

---

### Task 3: The app follows the URL

**Files:**
- Modify: `src/App.jsx` (whole file)
- Modify: `src/ui/useSorterApp.js` (header, imports, signature, `screen` and `source` state, `openPlaylist`, `changeSource`, the return object; one new effect)
- Modify: `src/ui/screens/Review.jsx` (destructuring, reading meter and error notice, the select's `disabled`)

**Interfaces:**
- Consumes: `useRoute`, from Task 1. `getPlaylist(client, playlistId, currentUserId)`, from Task 2.
- Produces:
  - `useSorterApp(auth, route, navigate, demo = null)`.
  - The returned object loses `screen`. Everything else keeps its name: `setScreen(view)` now navigates (`'playlists'`, `'sort'`, `'preview'`, `'progress'`, `'review'`), and `setSource(next)` navigates to that library.

There is no DOM in this repo's Vitest, and adding one would be a new dependency, so this task's proof is the browser check in Step 6, run in demo mode.

- [ ] **Step 1: Rewrite `src/App.jsx`**

Replace the whole file with:

```jsx
import { useAuth } from './auth/useAuth.js'
import { ConnectScreen } from './ui/screens/Connect.jsx'
import { PlaylistsScreen } from './ui/screens/Playlists.jsx'
import { PreviewScreen } from './ui/screens/Preview.jsx'
import { ProgressScreen } from './ui/screens/Progress.jsx'
import { ReviewScreen } from './ui/screens/Review.jsx'
import { SortScreen } from './ui/screens/Sort.jsx'
import { setFieldProjection } from './services/spotify/playlists.js'
import { enableApiLog } from './ui/apiLog.js'
import { ApiLog } from './ui/components/ApiLog.jsx'
import { loadDemo } from './ui/demoData.js'
import { useRoute } from './ui/route.js'
import { useSorterApp } from './ui/useSorterApp.js'

// Dev-only synthetic data, so the board can be designed against realistic
// content without a Spotify connection. Tree-shaken from production builds.
const demo = import.meta.env.DEV ? loadDemo() : null

// ?debug=1 records what the app sends and receives, so a bare "Forbidden"
// can be traced to a request. Dev only.
const debugging =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('debug')
enableApiLog(debugging)

// ?raw=1 drops the field projection, so the request log shows an item's real
// shape rather than only the fields the projection happened to name.
if (
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('raw')
) {
  setFieldProjection(false)
}

export default function App() {
  const auth = useAuth()
  const [route, navigate] = useRoute()
  const app = useSorterApp(auth, route, navigate, demo)
  // D46: a running write shows Progress whatever the URL says, for the moment
  // before the sync step puts the URL back, so no other screen's lever is on
  // screen mid-write.
  const view = app.run ? 'progress' : route.view

  // Connect is a gate, not a route (D45): signed out, it shows at any URL.
  const screen = !auth.isConnected && !demo
    ? <ConnectScreen auth={auth} />
    : view === 'sort'
      ? <SortScreen app={app} />
      : view === 'preview'
        ? <PreviewScreen app={app} />
        : view === 'progress'
          ? <ProgressScreen app={app} />
          : view === 'review'
            ? <ReviewScreen app={app} />
            : <PlaylistsScreen app={app} auth={auth} />

  return (
    <>
      {screen}
      {debugging ? <ApiLog /> : null}
    </>
  )
}
```

- [ ] **Step 2: `useSorterApp`: header, imports, signature, `source`, `setScreen`**

In `src/ui/useSorterApp.js`, replace:

```js
/**
 * Application state: what board is showing, what it is showing about, and
 * what happens when the lever is pulled.
 *
 * All the hard thinking lives in the pure layers underneath. This hook only
 * sequences them and holds their results.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  fetchPlaylistTracks,
  getCurrentUser,
  getPlaylistSnapshot,
  listEditablePlaylists,
} from '../services/spotify/playlists.js'
```

with:

```js
/**
 * Application state: what the board is showing, and what happens when the
 * lever is pulled. Which screen shows, which library is browsed and which
 * playlist is open belong to the URL (src/ui/route.js); this hook follows it.
 *
 * All the hard thinking lives in the pure layers underneath. This hook only
 * sequences them and holds their results.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchPlaylistTracks,
  getCurrentUser,
  getPlaylist,
  getPlaylistSnapshot,
  listEditablePlaylists,
} from '../services/spotify/playlists.js'
```

Replace:

```js
export const CSV_STRATEGY = 'csv'

export function useSorterApp(auth, demo = null) {
  const { client } = auth
  const writer = useMemo(() => createSpotifyWriter(client), [client])

  const [screen, setScreen] = useState(demo?.screen ?? 'playlists')
  const [me, setMe] = useState(demo?.me ?? null)
```

with:

```js
export const CSV_STRATEGY = 'csv'

/** A URL names a playlist this account has nothing at. */
const NOT_FOUND = 'This account has no playlist at that address.'

export function useSorterApp(auth, route, navigate, demo = null) {
  const { client } = auth
  const writer = useMemo(() => createSpotifyWriter(client), [client])

  const [me, setMe] = useState(demo?.me ?? null)
```

Replace:

```js
  const [source, setSource] = useState(demo?.source ?? 'spotify')
  const youtube = useMemo(() => createYouTubeClient({}), [])
```

with:

```js
  /**
   * Which library is being browsed: the path's source on a playlist route,
   * `?source` on home. The URL owns it (D41), so back and forward change it
   * just as the toggle does.
   */
  const source = route.source
  const youtube = useMemo(() => createYouTubeClient({}), [])

  /**
   * Show another screen of the open playlist, or the library (D47). The name
   * is kept so the screens did not have to change; it moves the URL, and the
   * URL decides what renders.
   */
  const setScreen = useCallback(
    (view) =>
      navigate(
        view === 'playlists'
          ? { view: 'home', source, playlistId: null }
          : { view, source, playlistId: route.playlistId },
      ),
    [navigate, source, route.playlistId],
  )
```

- [ ] **Step 3: `useSorterApp`: one loading path**

Replace the whole of `openPlaylist`:

```js
  const openPlaylist = useCallback(
    async (chosen) => {
      setError(null)
      setPlaylist(chosen)
      setTracks([])
      setCsv(null)
      setOutcome(null)
      setScreen('sort')

      if (demoRef.current) {
        setTracks(demoRef.current.tracks.slice(0, chosen.trackCount))
        return
      }

      setBusy({ label: `Reading ${chosen.name}`, done: 0, total: chosen.trackCount })
      try {
        if (chosen.source === 'youtube') {
          const fetched = await youtube.fetchPlaylist(chosen.id)
          setTracks(normalizeYouTubeTracks(fetched.tracks))
          return
        }
        const loaded = await fetchPlaylistTracks(client, chosen.id, {
          onProgress: (done, total) =>
            setBusy({ label: `Reading ${chosen.name}`, done, total }),
        })
        setTracks(loaded)
      } catch (failure) {
        setError(failure.message)
      } finally {
        setBusy(null)
      }
    },
    [client, youtube],
  )
```

with:

```js
  /** Bumped by every load, so only the latest one may land. */
  const loadTicket = useRef(0)

  /**
   * Read one playlist: from the row the board handed over, or, when the URL
   * named a playlist nothing has read yet, by id (routes design §5).
   */
  const loadPlaylist = useCallback(
    async (from, id, row = null) => {
      const ticket = ++loadTicket.current
      const latest = () => ticket === loadTicket.current
      setError(null)
      // A stand-in until the real row arrives. It names the route's playlist,
      // so the sync step sees it as open and does not start a second load.
      setPlaylist(row ?? { id, source: from })
      setTracks([])
      setCsv(null)
      setOutcome(null)

      if (demoRef.current) {
        const found = row ?? demoRef.current.playlists.find((item) => item.id === id)
        if (!found) {
          setError(NOT_FOUND)
          return
        }
        setPlaylist(found)
        setTracks(demoRef.current.tracks.slice(0, found.trackCount))
        return
      }

      setBusy({ label: row ? `Reading ${row.name}` : 'Reading the playlist', done: 0, total: row?.trackCount ?? 0 })
      try {
        if (from === 'youtube') {
          const fetched = await youtube.fetchPlaylist(id)
          if (!latest()) return
          // A system playlist such as Liked Music is dropped here, as it is
          // from the library, and so reads as not found.
          const found =
            row ?? toAppPlaylists([{ id, title: fetched.title, count: fetched.tracks?.length ?? 0 }])[0]
          if (!found) throw new Error(NOT_FOUND)
          setPlaylist(found)
          setTracks(normalizeYouTubeTracks(fetched.tracks))
          return
        }
        let chosen = row
        if (!chosen) {
          // `editable` and cloning both need to know who is signed in.
          const profile = me ?? (await getCurrentUser(client))
          if (!latest()) return
          setMe(profile)
          chosen = await getPlaylist(client, id, profile.id)
          if (!latest()) return
          setPlaylist(chosen)
        }
        const loaded = await fetchPlaylistTracks(client, id, {
          onProgress: (done, total) => {
            if (latest()) setBusy({ label: `Reading ${chosen.name}`, done, total })
          },
        })
        if (latest()) setTracks(loaded)
      } catch (failure) {
        if (latest()) setError(failure.message)
      } finally {
        if (latest()) setBusy(null)
      }
    },
    [client, youtube, me],
  )

  /** A row clicked on the board: its URL, and its tracks read as before. */
  const openPlaylist = useCallback(
    (chosen) => {
      const from = chosen.source ?? 'spotify'
      navigate({ view: 'sort', source: from, playlistId: chosen.id })
      loadPlaylist(from, chosen.id, chosen)
    },
    [navigate, loadPlaylist],
  )
```

- [ ] **Step 4: `useSorterApp`: the source reset, the sync step, the return object**

Replace the whole of `changeSource`:

```js
  const changeSource = useCallback(
    (next) => {
      // A strategy the new source cannot honour must not stay selected: it
      // would render pressed and disabled at once, keep driving the preview,
      // and be impossible to clear, because the only control that could
      // clear it is the disabled row itself.
      const nextStrategy = supportedStrategyFor(next, strategyId)
      setSource(next)
      setStrategyId(nextStrategy)
      setOptions(
        defaultStrategyOptionsFor(
          next,
          nextStrategy,
          // Carrying the old strategy's option values onto a different
          // strategy would seed it with keys it does not own.
          nextStrategy === strategyId ? options : defaultOptionsFor(nextStrategy),
        ),
      )
      setPlaylists([])
      setPlaylist(null)
      setTracks([])
      setError(null)
      setScreen('playlists')
    },
    [strategyId, options],
  )
```

with:

```js
  /** What changing library resets, whether by the toggle, back or forward. */
  const resetForSource = useCallback(
    (next) => {
      // A strategy the new source cannot honour must not stay selected: it
      // would render pressed and disabled at once, keep driving the preview,
      // and be impossible to clear, because the only control that could
      // clear it is the disabled row itself.
      const nextStrategy = supportedStrategyFor(next, strategyId)
      setStrategyId(nextStrategy)
      setOptions(
        defaultStrategyOptionsFor(
          next,
          nextStrategy,
          // Carrying the old strategy's option values onto a different
          // strategy would seed it with keys it does not own.
          nextStrategy === strategyId ? options : defaultOptionsFor(nextStrategy),
        ),
      )
      setPlaylists([])
      setPlaylist(null)
      setTracks([])
      setError(null)
    },
    [strategyId, options],
  )

  /** The library toggle. The sync step below performs the reset. */
  const changeSource = useCallback(
    (next) => navigate({ view: 'home', source: next, playlistId: null }),
    [navigate],
  )
```

Then replace the end of `undoLast` and the start of the return object:

```js
  }, [client, writer, playlist, writeBlocked])

  return {
    screen,
    setScreen,
```

with:

```js
  }, [client, writer, playlist, writeBlocked])

  /* ---- Following the URL ------------------------------------------------ */

  const ready = auth.isConnected || Boolean(demo)
  /** The source everything in memory was read for. */
  const stateSource = useRef(route.source)

  /**
   * Bring memory in line with the URL after any navigation: a click, back,
   * forward or a page load. See docs/2026-10-11-routes-design.md §5.
   */
  useEffect(() => {
    if (!ready) return
    // D46: while a write runs the URL stays on Progress, so back can never
    // reach a lever that would start a second write on the same playlist.
    if (run) {
      if (route.view !== 'progress' && playlist) {
        navigate({ view: 'progress', source: playlist.source ?? 'spotify', playlistId: playlist.id })
      }
      return
    }

    const switched = route.source !== stateSource.current
    if (switched) {
      stateSource.current = route.source
      resetForSource(route.source)
    }
    if (route.view === 'home') return

    const sort = { view: 'sort', source: route.source, playlistId: route.playlistId }
    const open =
      !switched && playlist?.id === route.playlistId && (playlist.source ?? 'spotify') === route.source
    if (!open) {
      // D44: Preview and Progress need an order chosen, or a write made, in
      // this tab. A playlist read from the URL has neither.
      if (route.view === 'preview' || route.view === 'progress') navigate(sort, { replace: true })
      // oxlint-disable-next-line react/set-state-in-effect -- the URL and the network are the outside systems this effect follows
      loadPlaylist(route.source, route.playlistId)
      return
    }
    // Progress with nothing to report, such as a forward step back onto it
    // after the playlist was opened afresh.
    if (route.view === 'progress' && !outcome) navigate(sort, { replace: true })
  }, [ready, run, route, playlist, outcome, navigate, loadPlaylist, resetForSource])

  return {
    setScreen,
```

The rest of the return object is unchanged. It still returns `setSource: changeSource`, `openPlaylist` and every other key, but no longer `screen`.

`setScreen` used to be a state setter, which never changes identity. It now changes with the route, so the two write paths that call it must list it. In `applyInPlace`, replace the dependency array:

```js
    [client, writer, playlist, tracks, targetTracks, ops, movedKeys, writeBlocked],
```

with:

```js
    [client, writer, playlist, tracks, targetTracks, ops, movedKeys, writeBlocked, setScreen],
```

In `applyClone`, replace:

```js
    [writer, playlist, me, targetTracks, strategyLabel, writeBlocked],
```

with:

```js
    [writer, playlist, me, targetTracks, strategyLabel, writeBlocked, setScreen],
```

- [ ] **Step 5: `Review.jsx`: wait for the Spotify side**

In `src/ui/screens/Review.jsx`, replace:

```jsx
  const { playlist, tracks, youtube, client, setScreen } = app
```

with:

```jsx
  const { playlist, tracks, youtube, client, setScreen, busy, error } = app
```

Replace:

```jsx
            : []
        }
      />

      <div className="section">
        <label className="field-label" htmlFor="review-youtube">
```

with:

```jsx
            : []
        }
      />

      {busy ? (
        <div className="section">
          <p className="col-label" style={{ marginBottom: 8 }}>
            {busy.label}
          </p>
          <Meter done={busy.done} total={busy.total || 1} />
        </div>
      ) : null}

      {error ? (
        <div className="section">
          <Notice tone="red" title="Could not read this playlist">
            {error}
          </Notice>
        </div>
      ) : null}

      <div className="section">
        <label className="field-label" htmlFor="review-youtube">
```

Replace:

```jsx
          onChange={(event) => review.choose(event.target.value)}
        >
          <option value="">Choose a YouTube Music playlist</option>
```

with:

```jsx
          onChange={(event) => review.choose(event.target.value)}
          // Matching scores against the Spotify tracks as they stand when a
          // playlist is chosen, so it waits until they have been read.
          disabled={tracks.length === 0}
        >
          <option value="">Choose a YouTube Music playlist</option>
```

`Meter` and `Notice` are already imported in this file.

- [ ] **Step 6: Tests, lint, build, then the demo check**

Run: `npm test`
Expected: 732 tests pass.

Run: `npm run lint`
Expected: exactly the two existing warnings. If `react(set-state-in-effect)` is reported at any other line inside the new sync effect, add the same `// oxlint-disable-next-line react/set-state-in-effect -- the URL and the network are the outside systems this effect follows` line directly above that line, and run lint again. No other new warning is acceptable.

Run: `npm run build`
Expected: builds with no errors.

Start or reuse the dev server per Global Constraints (`npm run dev:web` is enough). Then:

```bash
playwright-cli -s=check open "http://127.0.0.1:5173/?demo=1"
playwright-cli -s=check run-code "async page => {
  const B = 'http://127.0.0.1:5173'
  const at = () => page.evaluate(() => location.pathname + location.search)
  const settle = () => page.waitForTimeout(300)
  const out = {}
  await page.goto(B + '/?demo=1')
  await page.getByRole('row', { name: /Long Drive/ }).click()
  out.sort = await at()
  await page.getByRole('button', { name: 'Preview the change' }).click()
  out.preview = await at()
  await page.goBack(); await settle(); out.back = await at()
  await page.goForward(); await settle(); out.forward = await at()
  await page.reload(); await settle(); out.reloadPreview = await at()
  await page.goto(B + '/spotify/demo-3/preview?demo=1'); await settle(); out.cold = await at()
  await page.goto(B + '/spotify/nope?demo=1'); await settle()
  out.missing = await page.getByText('This account has no playlist at that address.').count()
  await page.goto(B + '/youtube/PLabc/review?demo=1'); await settle(); out.ytReview = await at()
  await page.goto(B + '/tidal/x?demo=1'); await settle(); out.unknown = await at()
  await page.goto(B + '/spotify/a%2F..%2Fme?demo=1'); await settle(); out.badId = await at()
  await page.goto(B + '/?demo=1&progress=running'); await settle(); out.pinned = await at()
  await page.goBack(); await settle(); out.pinnedBack = await at()
  out.stopLever = await page.getByRole('button', { name: 'Stop after this move' }).count()
  return JSON.stringify(out, null, 1)
}"
playwright-cli -s=check console error
playwright-cli -s=check close
```

Expected output, exactly:

```json
{
 "sort": "/spotify/demo-1?demo=1",
 "preview": "/spotify/demo-1/preview?demo=1",
 "back": "/spotify/demo-1?demo=1",
 "forward": "/spotify/demo-1/preview?demo=1",
 "reloadPreview": "/spotify/demo-1/preview?demo=1",
 "cold": "/spotify/demo-3?demo=1",
 "missing": 1,
 "ytReview": "/youtube/PLabc?demo=1",
 "unknown": "/?demo=1",
 "badId": "/?demo=1",
 "pinned": "/spotify/demo-1/progress?demo=1&progress=running",
 "pinnedBack": "/spotify/demo-1/progress?demo=1&progress=running",
 "stopLever": 1
}
```

The console must show 0 errors.

- `reloadPreview` stays on Preview because demo data seeds `demo-1` in memory, so it is never loaded by id.
- `cold` (`demo-3`, never seeded) is the D44 fallback.

If anything differs, fix it before staging. Stop the server if you started it.

- [ ] **Step 7: Stage**

```bash
git add src/App.jsx src/ui/useSorterApp.js src/ui/screens/Review.jsx
```

---

### Task 4: Demo links as real paths

**Files:**
- Modify: `src/ui/demoData.js` (`loadDemo`)
- Modify: `scripts/check-columns.js` (the `screens` list)
- Modify: `docs/STATUS.md` ("Seeing it without Spotify" table and the paragraph under it)
- Modify: `README.md` ("Seeing it without an account" table, plus one paragraph)

**Interfaces:**
- Consumes: `parseRoute`, from Task 1.
- Produces: demo data that picks its playlist from the path (`demo-2` is the nearly sorted one) and no longer has a `screen` key.

- [ ] **Step 1: `loadDemo` reads the path**

In `src/ui/demoData.js`, below the existing `import { normalizePlaylistItem } from '../model/track.js'`, add:

```js
import { parseRoute } from './route.js'
```

Replace:

```js
  const which = Number(params.get('playlist') ?? '1')
```

with:

```js
  // The path names the demo playlist (routes design §6); demo-2 is the
  // nearly sorted one.
  const which = parseRoute(window.location).playlistId === 'demo-2' ? 2 : 1
```

Delete these two lines from the returned object:

```js
    // Lets a capture land straight on one screen, in a given state.
    screen: params.get('screen') ?? 'playlists',
```

- [ ] **Step 2: The column check's URLs**

In `scripts/check-columns.js`, replace:

```js
  const screens = [
    ['playlists', '/?demo=1'],
    ['sort', '/?demo=1&screen=sort'],
    ['sort-csv', '/?demo=1&screen=sort&csv=1'],
    ['preview', '/?demo=1&screen=preview&playlist=2'],
    ['progress', '/?demo=1&screen=progress&playlist=2&progress=running'],
    ['progress-done', '/?demo=1&screen=progress&progress=done'],
    ['review', '/?demo=1&screen=review'],
  ]
```

with:

```js
  const screens = [
    ['playlists', '/?demo=1'],
    ['sort', '/spotify/demo-1?demo=1'],
    ['sort-csv', '/spotify/demo-1?demo=1&csv=1'],
    ['preview', '/spotify/demo-2/preview?demo=1'],
    ['progress', '/spotify/demo-2/progress?demo=1&progress=running'],
    ['progress-done', '/spotify/demo-1/progress?demo=1&progress=done'],
    ['review', '/spotify/demo-1/review?demo=1'],
  ]
```

- [ ] **Step 3: STATUS.md**

In `docs/STATUS.md`, under "### Seeing it without Spotify", replace the table and the paragraph under it:

```markdown
| URL | Shows |
|---|---|
| `/?demo=1` | Playlists |
| `/?demo=1&screen=sort` | Sort |
| `/?demo=1&screen=preview&playlist=2` | Preview with 12 moving against 42 holding |
| `/?demo=1&screen=progress&playlist=2&progress=running` | Progress mid-run at 18 of 45 |
| `/?demo=1&screen=progress&progress=done` | Progress, finished |
| `/?demo=1&screen=preview&playlist=2&focus=blocked` | Preview scrolled to the blocked tracks, proving their red treatment |
| `/?demo=1&screen=sort&csv=1` | Sort with a seeded CSV, reconciliation report, and a fuzzy suggestion to accept |
| `/?demo=1&screen=preview&playlist=2&limit=4` | A short playlist, which leaves the unlit board field visible |

`playlist=2` is a nearly-sorted playlist; `playlist=1` (default) is fully
shuffled so every row moves. Demo data is gated on `import.meta.env.DEV` and
tree-shaken from production.
```

with:

```markdown
| URL | Shows |
|---|---|
| `/?demo=1` | Playlists |
| `/spotify/demo-1?demo=1` | Sort |
| `/spotify/demo-2/preview?demo=1` | Preview with 12 moving against 42 holding |
| `/spotify/demo-2/progress?demo=1&progress=running` | Progress mid-run at 18 of 45 |
| `/spotify/demo-1/progress?demo=1&progress=done` | Progress, finished |
| `/spotify/demo-2/preview?demo=1&focus=blocked` | Preview scrolled to the blocked tracks, proving their red treatment |
| `/spotify/demo-1?demo=1&csv=1` | Sort with a seeded CSV, reconciliation report, and a fuzzy suggestion to accept |
| `/spotify/demo-2/preview?demo=1&limit=4` | A short playlist, which leaves the unlit board field visible |

`demo-2` is a nearly-sorted playlist; `demo-1` is fully shuffled so every row
moves. Demo data is gated on `import.meta.env.DEV` and tree-shaken from
production.
```

- [ ] **Step 4: README.md**

In `README.md`, under "## Seeing it without an account", replace:

```markdown
| `/?demo=1&screen=preview&playlist=2` | The diff board, 12 tracks moving against 42 holding |
| `/?demo=1&screen=progress&playlist=2&progress=running` | A reorder in flight |
| `/?demo=1&screen=sort&csv=1` | A CSV loaded, with a match awaiting confirmation |
```

with:

```markdown
| `/spotify/demo-2/preview?demo=1` | The diff board, 12 tracks moving against 42 holding |
| `/spotify/demo-2/progress?demo=1&progress=running` | A reorder in flight |
| `/spotify/demo-1?demo=1&csv=1` | A CSV loaded, with a match awaiting confirmation |
```

Then, after the paragraph that begins "The demo data is synthetic", add:

```markdown
Every screen has its own path (`/spotify/<id>/preview` and so on), so anything
serving a build must answer unknown paths with `index.html`. Vite's dev server
and `npm run preview` already do.
```

- [ ] **Step 5: Tests, lint, and the demo links**

Run: `npm test` (expected: 732 pass) and `npm run lint` (expected: exactly the two existing warnings).

Start or reuse the dev server (`npm run dev:web`). Then:

```bash
playwright-cli -s=check open "http://127.0.0.1:5173/?demo=1"
playwright-cli -s=check run-code "async page => {
  const links = [
    '/?demo=1',
    '/spotify/demo-1?demo=1',
    '/spotify/demo-1?demo=1&csv=1',
    '/spotify/demo-2/preview?demo=1',
    '/spotify/demo-2/preview?demo=1&focus=blocked',
    '/spotify/demo-2/preview?demo=1&limit=4',
    '/spotify/demo-2/progress?demo=1&progress=running',
    '/spotify/demo-1/progress?demo=1&progress=done',
  ]
  const moved = []
  for (const link of links) {
    await page.goto('http://127.0.0.1:5173' + link)
    await page.waitForTimeout(300)
    const at = await page.evaluate(() => location.pathname + location.search)
    if (at !== link) moved.push(link + ' -> ' + at)
  }
  await page.goto('http://127.0.0.1:5173/spotify/demo-2/preview?demo=1')
  const moving = await page.locator('.board-row[data-moves=\"true\"]').count()
  return JSON.stringify({ moved, moving })
}"
playwright-cli -s=check console error
playwright-cli -s=check close
```

Expected: `{"moved":[],"moving":12}`, and 0 console errors.

- `moved` empty means no demo link was sent elsewhere.
- `moving` 12 proves `demo-2` loads the nearly-sorted playlist. Every board row carries `data-moves`, `'true'` or `'false'`, so the selector names the value.

Then run the layout check, per the header of `scripts/check-columns.js`:

```bash
playwright-cli -s=columns open about:blank
playwright-cli -s=columns --raw run-code --filename=scripts/check-columns.js
playwright-cli -s=columns close
```

Expected: `{}`. Stop the server if you started it.

- [ ] **Step 6: Stage**

```bash
git add src/ui/demoData.js scripts/check-columns.js docs/STATUS.md README.md
```

---

### Task 5: The live walkthrough, and the record

**Files:**
- Modify: `docs/STATUS.md` (a new section, after "### Match review, catalogue search and the match tray — done 2026-10-11")

**Interfaces:**
- Consumes: everything above.
- Produces: the record.

- [ ] **Step 1: Start and sign in**

Start or reuse the servers with `npm run dev`, because the YouTube proxy is needed. Then:

```bash
playwright-cli -s=live open http://127.0.0.1:5173 --headed --profile=.playwright-cli/live-profile
```

If Connect shows, ask the owner to sign in to the Spotify test profile in that window, and wait. Never type credentials.

- [ ] **Step 2: Spotify, on "test punjabi songs" only**

Use `playwright-cli -s=live eval "location.pathname + location.search"` to read the URL after each action.

| Action | Expected |
|---|---|
| Click the "test punjabi songs" row | URL is exactly `/spotify/<id>`, with no `code=` or `state=` (Review Focus 2). Note the Tracks and Access tallies |
| "Preview the change" | `/spotify/<id>/preview` |
| `go-back`, then `go-forward` | `/spotify/<id>`, then `/spotify/<id>/preview` |
| "Dry run" (it reads the playlist and writes nothing) | `/spotify/<id>/progress`, showing the dry run's outcome |
| `reload` | `/spotify/<id>`: Sort, with the same Tracks and Access tallies as before (D44) |
| "Preview the change", then `reload` | `/spotify/<id>`: Sort again, same tallies (D44) |
| `reload` on Sort | The same playlist and tallies |
| "Match to YouTube" | `/spotify/<id>/review` |
| Choose the YouTube "test punjabi songs" under "Match against" | Note the Strong, Likely and Settled tallies |
| `reload` | While "Reading test punjabi songs" shows, "Match against" is disabled (Review Focus 3). Then it enables |
| Choose the YouTube "test punjabi songs" again | The same Strong, Likely and Settled tallies |

- [ ] **Step 3: YouTube, and changing library**

| Action | Expected |
|---|---|
| Back to the playlist, choose "Popularity", then "All playlists" | `/` |
| Source toggle to YouTube Music | `/?source=youtube`, the YouTube library |
| Click the YouTube "test punjabi songs" | `/youtube/<id>`. Access reads READ ONLY. "Popularity" is not the selected strategy, and no strategy row is both pressed and disabled (Review Focus 5) |
| `reload` | The same playlist and Tracks tally |
| `go-back` | `/?source=youtube` |
| `go-back` until `/` | The Spotify library, titled with the account's name |

- [ ] **Step 4: Signed out, on a playlist URL**

| Action | Expected |
|---|---|
| On `/`, "Disconnect" | Connect |
| `goto http://127.0.0.1:5173/spotify/<id>` (the test playlist's id) | Connect shows; the URL stays `/spotify/<id>` (D45) |
| "Connect". If Spotify asks for consent, ask the owner to approve it | Lands on `/`, signed in, with no `code=` in the URL |
| Click "test punjabi songs" | `/spotify/<id>` exactly |

- [ ] **Step 5: Console and clean-up**

Run: `playwright-cli -s=live console error`
Expected: 0 errors across the walkthrough.

Close the session (`playwright-cli -s=live close`) and stop any server you started. Nothing was written to either service, so there is nothing to undo.

- [ ] **Step 6: The record**

In `docs/STATUS.md`, after the section "### Match review, catalogue search and the match tray — done 2026-10-11" and before "## Open: features not built", add (with the date the walkthrough ran):

```markdown
## Routes — done <YYYY-MM-DD>

Every screen has its own URL, `/` stays home, and back and forward move
between screens. Spec: [2026-10-11-routes-design.md](2026-10-11-routes-design.md).

| Path | Screen |
|---|---|
| `/`, `/?source=youtube` | The Spotify or YouTube library (Connect while signed out) |
| `/:source/:id` | Sort |
| `/:source/:id/preview`, `/:source/:id/progress` | Preview, Progress |
| `/spotify/:id/review` | Match to YouTube |

- A refresh re-reads Sort and Review by id. Preview and Progress fall back to
  Sort, since the order chosen and the write made lived in that tab (D44).
- While a write runs the URL is held on Progress (D46).
- Spotify's redirect URI is still `/`, so no install has to re-register (D45).
- Checked live on "test punjabi songs" in both services: back and forward,
  refresh on every route, the library toggle and back, and a playlist URL
  opened signed out.
```

- [ ] **Step 7: Stage, and hand over**

```bash
git add docs/STATUS.md
```

Run `npm test` and `npm run lint` one last time. Then tell the owner the branch is ready to commit, listing what was checked in Tasks 3–5.
