# Status

**Last updated:** 2026-09-12 · **HEAD:** `6ed3866`

Design and decisions: [2026-09-09-spotify-playlist-sorter-design.md](2026-09-09-spotify-playlist-sorter-design.md).
Product truth: [../PRODUCT.md](../PRODUCT.md).
Direction contract: `.impeccable/surfaces/src-app-jsx.md`.
Design system: [../DESIGN.md](../DESIGN.md).

This file tracks only what is built and what is next.

---

## Where things stand

All logic layers and all five screens are built. **273 tests across 18 files,
all passing.** Build clean, design detector clean, working tree clean.

**The design review has run to a clean verdict and `DESIGN.md` is written, so
the direction contract's FINISH line is discharged.** Eight review rounds ran;
the last closed with no open findings.

Nothing has run against the live Spotify API. That needs a Client ID.

---

## Built

| Layer | Contents | Tests |
|---|---|---|
| `src/model/` | `normalize.js`, `track.js` | 28 |
| `src/sort/` | Nine strategies behind one registry | 59 |
| `src/plan/` | `diff.js`, `undo.js`, `execute.js`, `clone.js` | 62 |
| `src/csv/` | `parse.js`, `detectColumns.js`, `match.js`, `order.js` | 83 |
| `src/api/` | `client.js`, `playlists.js`, `mutations.js` | 41 |
| `src/auth/` | `pkce.js`, `spotifyAuth.js`, `useAuth.js` | 18 |
| `src/ui/` | Five screens, board components, app state | — |

### Load-bearing details worth not rediscovering

- **The diff algorithm.** A longest-increasing-subsequence pass means a
  re-sort costs one API call per genuinely displaced track, not one per
  track. Verified by replaying generated ops against 300 random permutations
  and a 1,000-track playlist.
- **Every sort strategy has a property test** asserting it returns a
  permutation of its input. That is what makes "a sort can never lose a
  track" a guarantee rather than a hope.
- **CSV title folding is deliberately conservative.** `(feat. X)` and
  remaster tags are dropped; `(Live)` and `(Remix)` are kept. Over-normalizing
  invents matches that get applied silently; under-normalizing only sends a
  row to the fuzzy tier where a human confirms it.
- **Refresh-token rotation** is handled and tested. Dropping a rotated token
  fails silently about an hour after login.

---

## The interface

Visual world: a **Solari split-flap departure board**, chosen through the
design skill's direction roll (seed `03dffa4e`, candidate 5 of seven grounded
directions, code-led).

A playlist is an ordered list whose whole purpose is that it rewrites itself,
so the rewrite is the event. Preview shows the scheduled order against the
current one in a two-numeral gutter; Progress is the same board turning over,
each row inking green as its own write returns.

### Seeing it without Spotify

`npm run dev`, then:

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

---

## Design review history

Eight passes ran against this build, all closed.

| Round | Outcome |
|---|---|
| 1 | `recapture` — screenshots predated the last write to the visual system |
| 2 | `fix` — eight material defects |
| 3 | `fix` — six of eight resolved, two partial, **three regressions from the fix batch itself** |
| 4 | `fix` — all resolved, no new regressions, one legacy defect (position gutter top-aligned) |
| 5 | `fix` — every fidelity element match; one material fix (phone lever stack) |
| 6 | `fix` — lever fix resolved; **three faults in the blank-flap ground I had just added** |
| 7 | `fix` — join and seam resolved; column rules partial at phone width |
| 8 | closed — all resolved, no regressions; one latent duplicate declaration |

Then `DESIGN.md` and `.impeccable/design.json` were written from the shipped
artifact, and the surface brief's one Unresolved item was marked resolved.

### Two rules the system depends on

Both were violated during the build, and each cost a review round. They are
recorded in DESIGN.md as named rules.

- **A cell that lays out horizontally must state `flex-direction: row`.** The
  shared board-cell rule makes every cell a column flex box, which silently
  reinterprets `justify-content` and `align-items`. This produced the
  bottom-aligned Playlists track cell and the top-aligned position gutter —
  the same bug twice, fixed in one place and missed in the other.
- **The board grid is declared once per screen per breakpoint**, on `.board` /
  `.board-playlists`. Header, seated rows, and the unlit field all inherit it,
  and `UnlitField` derives its module count from the resolved grid rather than
  a literal. Declaring it per element made the field draw four column modules
  against three seated rows at phone width — and a leftover duplicate nearly
  reopened it a third time.

### Known gaps, recorded as gaps

Not defects, and deliberately not done: no character-cell flapping on track
titles (only the position numerals flap), no grain on the "enamelled" board
body, and Connect's empty field is plain ground rather than blank flaps
(it has no scroller, and banding behind centred copy reads as a backdrop).
DESIGN.md records these as build gaps rather than system rules.

---

## Open: features not built

| # | Work | Notes |
|---|---|---|
| 1 | Resuming an interrupted run | Designed in §9.1. The undo snapshot is written and restorable, but "a tab died mid-run" detection on next load is not wired |
| 2 | Dry-run detail | Reports a count; does not list the operations |
| 3 | Live API verification | Nothing has touched real Spotify. First run against a real playlist is the real test |

---

## Before the app can talk to Spotify

One-time setup on the Spotify Developer Dashboard, not yet done:

1. Create an app and copy its **Client ID** (PKCE needs no client secret).
2. Register the redirect URI **exactly** as `http://127.0.0.1:5173/` —
   trailing slash included. `localhost` is rejected outright; anything
   deployed must be HTTPS.
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

Two oxlint warnings are expected and were judged false positives: a ref read
inside a lazy async closure in `src/auth/useAuth.js`, and setState inside a
timer-driven animation effect in `src/ui/components/Flap.jsx`.

---

## Two capture gotchas that cost a review round each

**Chrome on Windows clamps its window to a 500px minimum.** A
`--window-size=390` capture silently renders a 500px layout and crops it, so
it looks like a horizontal-overflow bug that does not exist. For a true phone
render, load the app in a 390px-wide iframe and capture that frame. Write the
harness to `public/`, capture, then delete it so it cannot ship.

**`git add` rewrites working-tree files during CRLF normalization**, bumping
their mtime without changing content. A freshness check comparing source
mtimes against screenshot mtimes will report stale captures that are fine.
Capture *after* committing, not before.

The review refuses to score a build whose screenshots predate the last write
to the visual system, and it is right to. Capture from a committed tree, in
one window, with no edits in between, and verify with:

```
find src -type f \( -name "*.js" -o -name "*.jsx" -o -name "*.css" \) \
  -newer .impeccable/review/desktop.png -print
```

---

## Suggested order when picking back up

1. **Register a Spotify app and run this against a real playlist.** This is
   the only remaining unknown of any size — nothing has touched the live API,
   so every network path is tested against mocks and nothing else.
2. Resuming an interrupted run, and listing operations in the dry run.
3. Optionally the two open ceiling items: character-cell flapping on titles,
   and grain on the board body.
