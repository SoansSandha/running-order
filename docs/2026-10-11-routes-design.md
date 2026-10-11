# Routes — Design

**Date:** 2026-10-11
**Status:** Draft for review
**Scope:** How the app's screens are reached. Every screen today renders under
`/`, picked by a `screen` string in `useSorterApp`. This gives each screen its
own URL and keeps `/` as home. No screen's content changes. Earlier designs'
decisions still hold; D41–D47 below are new.

---

## 1. What this is

Each screen gets its own path. The URL decides which screen shows, which
library is being browsed, and which playlist is open. Back and forward move
between screens, and a refresh reopens what it can.

**Why:** with one route, the browser's back button leaves the app, a refresh
always lands on the library, and nothing can be bookmarked or linked to.

**Testing** uses the playlist "test punjabi songs" on the owner's test
profiles in Spotify and YouTube Music.

**Done when:**
- every screen has the path in §3, and `/` is home;
- back and forward move through screens in the order visited;
- a refresh on Sort or Review of "test punjabi songs" on Spotify reopens the
  same playlist, and so does a refresh on Sort of the YouTube copy;
- a refresh on Preview or Progress lands on that playlist's Sort;
- pressing back during a write keeps Progress on screen, and no second write
  can start;
- every demo link in STATUS.md and README.md opens its screen, and
  `scripts/check-columns.js` passes against the new links;
- `npm test` and `npm run lint` pass.

---

## 2. Decisions

Continuing the numbering in the earlier designs.

| # | Decision | Rejected | Why |
|---|---|---|---|
| D41 | **The URL owns the screen, the library source, and the open playlist.** `useSorterApp` owns everything else: tracks, strategy, options, CSV, run, outcome | Mirroring the `screen` state into the URL | Two sources of truth would disagree after back, forward, or a refresh. One owner per fact |
| D42 | **A small router in one file,** `src/ui/route.js`, built on `pushState`, `replaceState` and `popstate` | `react-router`; hash URLs (`/#/…`) | The owner's choice. The whole scheme is one pattern with four views, and every screen change already goes through one function. Hash URLs would avoid a server fallback but undo the clean paths of D43. If pages with their own layouts arrive, only this file is swapped |
| D43 | **The source is in the path:** `/spotify/:id`, `/youtube/:id`. The YouTube library is `/?source=youtube` | `/playlist/:id?source=…`; `/youtube` as a second library page | The owner's choice. A refresh must know which service owns the id before it can fetch it. `/` stays the only home |
| D44 | **Reload what it can.** Sort and Review re-fetch the playlist by id. Preview and Progress fall back to Sort when the playlist had to be loaded from the URL | Strategy and options in the query string; every refresh going home | The owner's choice. A reloaded Preview would show the default order as if it had been chosen. A CSV is a local file and cannot survive a refresh either way |
| D45 | **Connect is a gate, not a route.** It renders at whatever URL is open while signed out. Spotify's redirect URI stays `/` | A `/connect` route; a new redirect URI such as `/callback` | Every self-hoster registered `http://127.0.0.1:5173/` with Spotify. A new URI breaks every install until it is re-registered |
| D46 | **While a write runs, the URL is held on Progress.** Back or forward during a run puts the Progress URL straight back | Letting the browser leave Progress mid-write | Leaving would reach Sort while the write carries on, and from there a second write could start against the same playlist. The on-screen back button already hides during a run |
| D47 | **`setScreen` keeps its name and navigates.** `setScreen('preview')` pushes the open playlist's Preview path | Renaming it to `navigate` or `go` across the screens | Sort, Preview, Progress and Review do not change at all |

---

## 3. The routes

| Path | Screen |
|---|---|
| `/` | Connect while signed out; the Spotify library once signed in |
| `/?source=youtube` | The YouTube library |
| `/:source/:id` | Sort. `:source` is `spotify` or `youtube` |
| `/:source/:id/preview` | Preview |
| `/:source/:id/progress` | Progress |
| `/spotify/:id/review` | Match to YouTube |

- **`/youtube/:id/review`** is replaced by `/youtube/:id`. Review starts from
  a Spotify playlist, and Sort offers "Match to YouTube" only there.
- **Any other path** — an unknown source, an unknown view, extra segments — is
  replaced by `/`.
- **The id is URI-encoded** in the path and decoded when read.
- **Other query parameters are kept** as the app moves between screens, so
  `?debug=1`, `?raw=1` and `?demo=1` survive navigation.

---

## 4. The router

`src/ui/route.js` holds three things:

- **`parseRoute({ pathname, search })`** returns
  `{ view, source, playlistId }`.
  - `view` is `home`, `sort`, `preview`, `progress` or `review`.
  - On `home`, `source` comes from `?source`, defaulting to `spotify`, and
    `playlistId` is `null`.
  - A path §3 does not allow returns `{ redirect: '<path>' }` instead.
- **`pathFor(route)`** is the inverse: a route back to its path. For any route
  `parseRoute` accepts, `parseRoute(pathFor(route))` gives the same route.
- **`useRoute()`** returns `[route, navigate]`.
  - `navigate(path, { replace })` calls `pushState` or `replaceState`, then
    updates the route.
  - A `popstate` listener updates the route on back and forward.
  - A `redirect` from `parseRoute` is applied with `replaceState` before the
    route is returned, so no screen ever sees one.

The two functions are pure, so the URL scheme can be tested without a
browser.

---

## 5. State and the URL

### What moves

- **`App.jsx`** calls `useRoute()` and passes the route and `navigate` into
  `useSorterApp`. It picks the screen from `route.view` instead of
  `app.screen`. Connect still renders first while signed out (D45).
- **`useSorterApp` drops its `screen` state** and `setScreen` becomes
  navigation (D47):
  - `setScreen('playlists')` pushes `/`, with `?source=youtube` when the
    library being browsed is YouTube's;
  - `setScreen(view)` for any other view pushes that view's path for the open
    playlist.
- **`source` is derived,** not stored. On a playlist route it is the path's
  source; on home, `?source`. `capabilitySource` is unchanged
  (`playlist?.source ?? source`).
- **The source toggle navigates** to `/` or `/?source=youtube`. The reset that
  `changeSource` performs today — clear the library, drop a strategy the new
  source cannot run, reseed options — now runs whenever the URL's source
  changes, so back and forward get the same reset as the toggle.
- **Clicking a playlist on the board** hands its row to the hook and pushes
  `/:source/:id`. The sync step below does the loading, so there is one
  loading path whether the playlist was clicked, refreshed, or reached with
  back.

### The sync step

One step in `useSorterApp` brings memory in line with the URL. It waits until
the user is signed in, or demo data is loaded, before it reads anything.

| The URL names | In memory | Then |
|---|---|---|
| A playlist | That playlist, already loaded | Nothing |
| A playlist | The row handed over by a click on the board | Load its tracks, as `openPlaylist` does today |
| A playlist | Nothing, or a different playlist | Load it by id (below), then its tracks |
| Preview | A playlist the sync step had to load by id | Replace with that playlist's Sort (D44) |
| Progress | No run and no outcome | Replace with that playlist's Sort (D44) |
| Any route but Progress | A run in progress | Replace with the open playlist's Progress (D46) |
| A source other than the loaded one | — | The `changeSource` reset |

**Loading by id:**
- **Spotify:** a new `getPlaylist(client, id, currentUserId)` in
  `src/services/spotify/playlists.js`. It fetches `/playlists/{id}` and builds
  the row with the same code as `listEditablePlaylists`, moved into a shared
  `toPlaylist(item, currentUserId)` so access, track count and snapshot id
  are worked out one way. `me` is fetched first when it is not yet known,
  because `editable` and cloning both need it.
- **YouTube:** the existing `youtube.fetchPlaylist(id)` returns the title and
  tracks in one call. The row comes from
  `toAppPlaylists([{ id, title, count: tracks.length }])`, and the tracks from
  `normalizeYouTubeTracks`, exactly as today.

**Loads that land late are dropped.** Each load remembers the route it
started for and sets nothing if the URL has moved on by the time it returns.
StrictMode's second effect pass in development is absorbed the same way.

### Unchanged

- **Spotify's redirect** still lands on `/` with `?code=`, and `useAuth`
  clears the query as today (D45).
- **The match book and undo snapshots** are already in `localStorage`, so
  Review keeps its decisions across a refresh. Catalogue search results do
  not survive one, as they do not survive leaving Review today.
- **`?debug=1` and `?raw=1`** are read once at start-up, from any path.

---

## 6. Demo links

`screen=` and `playlist=` are retired; the path names the screen and the
demo playlist. `demo-2` is the nearly sorted one, as `playlist=2` was.

| Before | After |
|---|---|
| `/?demo=1` | `/?demo=1` |
| `/?demo=1&screen=sort` | `/spotify/demo-1?demo=1` |
| `/?demo=1&screen=sort&csv=1` | `/spotify/demo-1?demo=1&csv=1` |
| `/?demo=1&screen=preview&playlist=2` | `/spotify/demo-2/preview?demo=1` |
| `/?demo=1&screen=preview&playlist=2&focus=blocked` | `/spotify/demo-2/preview?demo=1&focus=blocked` |
| `/?demo=1&screen=preview&playlist=2&limit=4` | `/spotify/demo-2/preview?demo=1&limit=4` |
| `/?demo=1&screen=progress&playlist=2&progress=running` | `/spotify/demo-2/progress?demo=1&progress=running` |
| `/?demo=1&screen=progress&progress=done` | `/spotify/demo-1/progress?demo=1&progress=done` |
| `/?demo=1&screen=review` | `/spotify/demo-1/review?demo=1` |

- **`progress`, `focus`, `csv` and `limit`** stay as query parameters.
- **Demo data seeds the playlist** in memory, so the sync step never treats a
  demo route as loaded by id, and demo Preview and Progress links open
  directly.
- **`loadDemo`** reads the playlist id from the path instead of `playlist=`
  and `screen=`.

---

## 7. The pieces

| Piece | Change | Proven by |
|---|---|---|
| `src/ui/route.js` | New: `parseRoute`, `pathFor`, `useRoute` (§4) | `route.test.js` |
| `src/App.jsx` | Picks the screen from the route; passes route and `navigate` to the hook | The walkthrough |
| `src/ui/useSorterApp.js` | Drops `screen`; `setScreen` navigates; `source` derived; the sync step (§5) | The walkthrough |
| `src/services/spotify/playlists.js` | `toPlaylist` shared by `listEditablePlaylists` and new `getPlaylist` | `playlists.test.js` |
| `src/ui/demoData.js` | Playlist from the path; `screen=` and `playlist=` retired (§6) | `check-columns.js` |
| `scripts/check-columns.js` | Its seven screen URLs move to §6's paths | Running it |
| `docs/STATUS.md`, `README.md` | Demo URL tables updated; README notes that a host must serve `index.html` for unknown paths | Reading them |

The screens — Connect, Playlists, Sort, Preview, Progress, Review — and the
match tray are not changed.

---

## 8. Testing

**`src/ui/route.test.js`:**
- every route in §3 survives `pathFor` then `parseRoute` unchanged;
- `/` and `/?source=youtube` parse to home with the right source, and an
  unknown `?source` falls back to `spotify`;
- an id with characters that need encoding round-trips;
- each bad path redirects: unknown source, unknown view, extra segments,
  `/youtube/:id/review`;
- query parameters other than `source` are carried by `pathFor`.

**`src/services/spotify/playlists.test.js`:** `getPlaylist` builds the same row
as `listEditablePlaylists` does for the same playlist, including `editable`
for an owned, a collaborative, and someone else's playlist.

**In the browser,** on the test profiles, with "test punjabi songs":
- back and forward through Library → Sort → Preview → Progress → Sort →
  Review → Library;
- refresh on each route, for Spotify and for YouTube;
- the source toggle, then back: the Spotify library returns, reset as the
  toggle resets it;
- back pressed during a dry run: Progress stays;
- a playlist URL opened while signed out: Connect shows; after sign-in, `/`;
- every demo link in §6, and `scripts/check-columns.js`.

`npm test` and `npm run lint` pass.

---

## 9. When things go wrong

| Case | What happens |
|---|---|
| The id does not exist, or the account cannot read it | Sort shows the existing error notice, with "All playlists" to go back |
| `/youtube/LM` or another YouTube system playlist | `toAppPlaylists` drops it, so it is treated as not found |
| The proxy is not running and the URL names a YouTube playlist | The existing proxy error shows on Sort |
| Two loads race (a quick back, then forward) | The earlier one lands, sees the URL has moved on, and sets nothing (§5) |
| A refresh during a write | The write stops with the page, as today. The URL is Progress, which has no run or outcome after the reload, so it falls back to Sort (D44) |
| A sign-in that started on a deep link | Lands on `/` (D45; return-to is in §10) |
| A host that does not fall back to `index.html` | Deep links 404. Vite's dev server and `vite preview` already fall back; README says so for self-hosting |

---

## 10. Not in this plan

| Left out | Add when |
|---|---|
| Returning to the page that was open before sign-in (a path saved in `sessionStorage` beside the PKCE verifier) | Signing in from a deep link becomes common enough to be annoying |
| Strategy and options in the query string | A Preview link needs to reproduce an order (D44) |
| `react-router` | Pages with their own layouts or loaders arrive (D42) |
| Splitting screens into separately loaded bundles | The bundle grows enough for start-up to suffer |
| Hosting configuration for a particular platform | There is a hosted version |
