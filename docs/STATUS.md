# Status

**Last updated:** 2026-09-10

Design and decisions live in
[2026-09-09-spotify-playlist-sorter-design.md](2026-09-09-spotify-playlist-sorter-design.md).
Product truth lives in [../PRODUCT.md](../PRODUCT.md). This file tracks only
what is built and what is next.

---

## Where things stand

Every layer is built and the five screens exist. **272 tests across 18 files,
all passing.** Build clean, lint clean apart from two judged false positives,
design detector clean.

Nothing has yet run against the live Spotify API — that needs a Client ID
(see below). The UI can be driven without one via the dev-only demo fixture.

---

## Built

| Layer | Contents | Tests |
|---|---|---|
| `src/model/` | `normalize.js`, `track.js` | 28 |
| `src/sort/` | Nine strategies behind one registry | 59 |
| `src/plan/` | `diff.js`, `undo.js`, `execute.js`, `clone.js` | 62 |
| `src/csv/` | `parse.js`, `detectColumns.js`, `match.js`, `order.js` | 82 |
| `src/api/` | `client.js`, `playlists.js`, `mutations.js` | 41 |
| `src/auth/` | `pkce.js`, `spotifyAuth.js`, `useAuth.js` | 18 |
| `src/ui/` | Five screens, board components, app state | — |

### Worth knowing

- **The diff algorithm is the load-bearing piece.** A
  longest-increasing-subsequence pass means a re-sort costs one API call per
  genuinely displaced track, not one per track. Verified by replaying
  generated operations against 300 random permutations and a 1,000-track
  playlist.
- **Every sort strategy has a property test** asserting it returns a
  permutation of its input. That invariant is what makes "a sort can never
  lose a track" a guarantee.
- **CSV title folding is deliberately conservative.** `(feat. X)` and
  remaster tags are dropped; `(Live)` and `(Remix)` are kept. Over-normalizing
  invents matches that get applied silently, while under-normalizing only
  sends a row to the fuzzy tier where a human confirms it.
- **Refresh-token rotation is handled and tested** — dropping a rotated token
  fails silently about an hour after login.

---

## The interface

The visual world is a **Solari split-flap departure board**, chosen through
the design skill's direction roll (seed `03dffa4e`, candidate 5 of seven
grounded directions). The full contract is in
`.impeccable/surfaces/src-app-jsx.md`.

The idea: a playlist is an ordered list whose whole purpose is that it
rewrites itself, so the rewrite is the event. Preview shows the scheduled
order against the current one in a two-numeral gutter; Progress is the same
board turning over, with each row flapping as its own write returns — the
motion is the progress, not decoration beside it.

| Screen | State |
|---|---|
| Connect | Client ID, copyable redirect URI, setup notes |
| Playlists | Board of destinations, editable vs clone-only |
| Sort | Strategy list, per-strategy options, CSV mapping and reconciliation, live peek at the resulting order |
| Preview | The diff board, with writes and estimated time |
| Progress | The board turning over, cancel, undo, outcome |

### Seeing it without Spotify

`npm run dev`, then append `?demo=1` — a synthetic 54-track playlist, gated on
`import.meta.env.DEV` so it is tree-shaken from production. Add
`&screen=preview` (or `sort`, `playlists`) to land on one directly.

---

## Not built

| # | Work | Notes |
|---|---|---|
| 1 | **Accepting fuzzy CSV suggestions in the UI** | `buildCsvOrder` already takes `acceptedSuggestions` and it is tested; the review UI for accepting them per-row is not built, so near-miss rows currently stay unmatched |
| 2 | **Resuming an interrupted run** | Designed in §9.1. The undo snapshot is written and restorable, but the "a tab died mid-run" detection on next load is not wired |
| 3 | **Dry-run output detail** | The dry run reports a count; it does not yet list the operations |
| 4 | **Live API verification** | Nothing has touched real Spotify. First run against a real playlist is the real test |

---

## Before the app can talk to Spotify

A one-time setup on the Spotify Developer Dashboard, not yet done:

1. Create an app and copy its **Client ID** (PKCE needs no client secret).
2. Register the redirect URI **exactly** as `http://127.0.0.1:5173/` — trailing
   slash included. `localhost` is rejected outright; anything deployed must be
   HTTPS.
3. The app stays in Development Mode, which is enough for one user.

---

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server on `http://127.0.0.1:5173/` |
| `npm test` | Run the suite once |
| `npm run test:watch` | Watch mode |
| `npm run lint` | Oxlint over `src` |
| `npm run build` | Production build |

### Capturing screenshots

Chrome on Windows clamps its window to a 500px minimum, so a
`--window-size=390` capture silently renders a 500px layout and crops it. For
a true phone-width render, load the app in a 390px-wide iframe and capture
that frame instead.
