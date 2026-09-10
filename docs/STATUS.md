# Status

**Last updated:** 2026-09-09

Design and decisions live in
[2026-09-09-spotify-playlist-sorter-design.md](2026-09-09-spotify-playlist-sorter-design.md).
This file tracks only what is built and what is next.

---

## Where things stand

Every layer that does not touch the screen is built and tested. **164 tests
across 11 files, all passing.** The build is clean and `npm run dev` serves a
placeholder shell listing the layers and the available sort strategies.

No Spotify credentials have been used yet, so nothing in the app has been run
against the live API.

---

## Built

| Layer | Contents | Tests |
|---|---|---|
| `src/model/` | `normalize.js`, `track.js` — folds raw playlist items into the flat Track shape every other layer reads | 28 |
| `src/sort/` | `comparators.js`, `artistGrouped.js`, `albumGrouped.js`, `shuffle.js`, `index.js` — nine strategies behind one registry | 59 |
| `src/plan/` | `diff.js` — target order to Spotify reorder operations | 18 |
| `src/api/` | `client.js`, `playlists.js`, `mutations.js` — HTTP client with retry, pagination, reads and writes | 41 |
| `src/auth/` | `pkce.js`, `spotifyAuth.js` — PKCE handshake and token lifecycle | 18 |

### Worth knowing about what is already in place

- **The diff algorithm is the load-bearing piece.** It uses a
  longest-increasing-subsequence pass, so re-sorting a nearly-sorted playlist
  costs one API call per genuinely displaced track rather than one per track.
  Moving five tracks to the front of a hundred costs five calls. Its index
  arithmetic is verified by replaying generated operations against 300 random
  permutations and a 1,000-track playlist.
- **Sort strategies are pure functions** over plain arrays, with a property
  test asserting every strategy returns a permutation of its input — same
  length, same tracks. That single invariant is what guarantees a sort can
  never lose a track.
- **The PKCE challenge is pinned to the RFC 7636 worked example**, because
  drift there shows up only as an opaque handshake failure.
- **Refresh-token rotation is handled and tested.** Spotify rotates the
  refresh token on every use; dropping the new one makes the app fail silently
  about an hour after login.

---

## Not built

In the order it should be picked up.

| # | Work | Notes |
|---|---|---|
| 1 | **The five screens** — Connect, Playlists, Sort, Preview, Progress | Design direction was being established when this session stopped. See below |
| 2 | **`plan/undo.js`** | Snapshot before write, restore after. Designed in §9.1, not yet written |
| 3 | **The execute loop** | Walks the operation list, keeps a local mirror in lockstep, threads `snapshot_id` between calls, reports progress, supports cancel |
| 4 | **Clone-and-sort** | Create, then bulk-add in 100-URI chunks. `createPlaylist` and `addTracksInChunks` already exist and are tested; the flow around them is not written |
| 5 | **`src/csv/`** | `parse.js`, `detectColumns.js`, `match.js`, `order.js`. Fully designed in §7. PapaParse is already installed |
| 6 | **Dry-run mode** | Logs the operation list without sending it, for checking against a throwaway playlist |

---

## Where the UI work stopped

The `impeccable` design skill was mid-interview. Three answers were captured
and are now recorded as D7, D8 and D9 in the design doc:

- **Audience:** the author alone, so the Connect screen stays terse.
- **Devices:** desktop and mobile equally, so the before/after diff needs two
  real layouts rather than one squeezed into the other.
- **Scale:** ~400 tracks today, expected to grow, so track lists are windowed
  from the start.

**To resume:** the skill's `init` step still needs `PRODUCT.md` written from
those answers, after which `reference/new-work.md` establishes the visual
world. Nothing else is blocked on it — items 2 through 6 above are all
independent of the UI and could be built first.

---

## Before the app can talk to Spotify

A one-time setup on the Spotify Developer Dashboard, not yet done:

1. Create an app and copy its **Client ID** (there is no client secret in the
   PKCE flow, so none is needed).
2. Register the redirect URI **exactly** as `http://127.0.0.1:5173/` — note
   the trailing slash, and note that `localhost` is rejected. Anything
   deployed must be HTTPS.
3. The app stays in Development Mode, which is sufficient for personal use.

---

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server on `http://127.0.0.1:5173/` |
| `npm test` | Run the suite once |
| `npm run test:watch` | Watch mode |
| `npm run lint` | Oxlint over `src` |
| `npm run build` | Production build |
