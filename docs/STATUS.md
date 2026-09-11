# Status

**Last updated:** 2026-09-10 · **HEAD:** `076fd39`

Design and decisions: [2026-09-09-spotify-playlist-sorter-design.md](2026-09-09-spotify-playlist-sorter-design.md).
Product truth: [../PRODUCT.md](../PRODUCT.md).
Direction contract: `.impeccable/surfaces/src-app-jsx.md`.

This file tracks only what is built and what is next.

---

## Where things stand

All logic layers and all five screens are built. **272 tests across 18 files,
all passing.** Build clean, design detector clean, working tree clean.

Two things are explicitly *not* finished, and both are recorded below: the
design review's last pass came back `fix` with three regressions my own fix
batch introduced, and `DESIGN.md` has never been written, which the direction
contract's FINISH line requires.

Nothing has run against the live Spotify API. That needs a Client ID.

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

`playlist=2` is a nearly-sorted playlist; `playlist=1` (default) is fully
shuffled so every row moves. Demo data is gated on `import.meta.env.DEV` and
tree-shaken from production.

---

## Open: design review round 3 came back `fix`

Three review cycles have run. Round 1 refused to score the build
(`recapture` — my screenshots predated the last write to the visual system).
Round 2 returned eight material fixes. Round 3 scored those fixes and found
new regressions.

**Round 3 verdict: 6 of 8 resolved, 2 partial, 3 regressions introduced by
the fix batch itself.** In priority order:

### 1. Playlists draws two misaligned column grids

`--cols` is set on `.pl-row` only (`src/ui/board.css`, the `.pl-row` block),
so `.board-cols` on that screen falls back to the five-column default. The
hard column rules added in round 2 made the divergence structural: header
rules land at roughly x=1032 and x=1215 while row rules land at x=1172 and
x=1300, and the OWNER label sits ~145px left of its values.

**Fix:** set `--cols` and `--row-h` on a shared parent, or on `.board-cols`
for that screen, so one grid governs both.

### 2. Playlists TRACKS cell stacks and bottom-aligns

Round 2 made every `.board-row > *` a column flex box. The TRACKS cell in
`src/ui/screens/Playlists.jsx` carries an inline
`display:flex; align-items:center; justify-content:flex-end`, which overrides
neither `flex-direction: column` nor the axis meaning — so `flex-end` now
pushes content to the *bottom* and the CLONE ONLY chip sits *under* the count.

**Fix:** give that cell an explicit `flex-direction: row`.

### 3. Sort's scroll region clips mid-sentence with no affordance

`Frame fill` + `.board-scroll` on Sort cuts SHUFFLE's description at "The same
seed / always shuffles the same way", and the HOW IT STARTS list cuts through
a row, each against a hard edge. On the diff board a half-row reads as a flap
mid-turn; on a card list it reads as broken layout. Needs a fade, rule, or
partial-row cue.

### Also open

- **Blocked-row red is unproven.** The rule exists
  (`.board-row[data-blocked='true'] .row-title { color: var(--red) }`) but no
  capture shows it: the two blocked tracks sit near positions 53–54 and every
  Preview capture is windowed to rows 1–10. Needs one capture scrolled to
  them. A rule in CSS is not evidence.
- **Ceiling notes, deferred by agreement.** Character-cell flapping is
  confined to two numerals rather than every string; the staggered cascade
  the contract names never fires (one row turns at a time); empty board ground
  is dead space rather than unlit blank flaps. The reviewer agreed these are
  ceiling, not material defects. Reconsider only after Playlists is square.
- **`DESIGN.md` has never been written.** The contract's FINISH line requires
  it, written at finish from the built world by the shipped documenter. Until
  it exists this build is incomplete by its own terms.

---

## Open: features not built

| # | Work | Notes |
|---|---|---|
| 1 | Accepting fuzzy CSV suggestions in the UI | `buildCsvOrder` already takes `acceptedSuggestions` and it is tested; the per-row accept/reject UI does not exist, so near-miss rows currently stay unmatched |
| 2 | Resuming an interrupted run | Designed in §9.1. The undo snapshot is written and restorable, but "a tab died mid-run" detection on next load is not wired |
| 3 | Dry-run detail | Reports a count; does not list the operations |
| 4 | Live API verification | Nothing has touched real Spotify. First run against a real playlist is the real test |

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

1. The two Playlists regressions — it is the screen the tool opens on, and
   both are on the fix batch's own account.
2. Sort's scroll clip.
3. Recapture, including one Preview scrolled to the blocked tracks, and
   re-run the finish reviewer for a verdict.
4. Write `DESIGN.md` via the shipped documenter, discharging the FINISH line.
5. Register a Spotify app and run the whole thing against a real playlist.
