# Status

**Last updated:** 2026-09-16 · **HEAD:** `see git log`

Design and decisions: [2026-09-09-design.md](2026-09-09-design.md).
Product truth: [../PRODUCT.md](../PRODUCT.md).
Direction contract: `.impeccable/surfaces/src-app-jsx.md`.
Design system: [../DESIGN.md](../DESIGN.md).

Planned work: [ROADMAP.md](ROADMAP.md).

This file tracks only what is built and what is next.

---

## Where things stand

All logic layers and all five screens are built. **300 tests across 19 files,
all passing.** Build clean, design detector clean, working tree clean.

The project was renamed from `spotify-playlist-sorter` to **Running Order**
when YouTube Music support and cross-service reconciliation entered scope —
a Spotify-specific name would not have survived it.

**The design review has run to a clean verdict and `DESIGN.md` is written, so
the direction contract's FINISH line is discharged.** Eight review rounds ran;
the last closed with no open findings.

**Live status:** reads and writes both work. A 414-track playlist has been
fetched, sorted, previewed and diffed against the real API.

On 2026-09-22 the write path was proven end to end against a live account:

| Exercised | Result |
|---|---|
| In-place reorder, single move | `PUT /playlists/{id}/items` → 200 |
| In-place reorder, many moves (reverse) | Every write 200, each quoting the previous `snapshot_id` |
| `added_at` after reordering | **Preserved** — the playlist still sorts correctly by date added |
| Clone-and-sort | `POST /me/playlists` → **201**, then `POST /playlists/{id}/items` → 201 |

The 403 that previously blocked playlist creation is gone: `/me/playlists`
answers, so the legacy `/users/{id}/playlists` fallback was never reached.

Still not run live: a reorder at full scale (the largest real run is a small
playlist), undo, and mid-run cancel.

---

## Built

| Layer | Contents | Tests |
|---|---|---|
| `src/model/` | `normalize.js`, `track.js` | 28 |
| `src/sort/` | Nine strategies behind one registry | 59 |
| `src/plan/` | `diff.js`, `undo.js`, `execute.js`, `clone.js` | 57 |
| `src/csv/` | `parse.js`, `detectColumns.js`, `match.js`, `order.js` | 83 |
| `src/services/spotify/` | `client.js`, `playlists.js`, `mutations.js`, `spotifyAuth.js`, `writer.js` | 69 |
| `src/auth/` | `pkce.js`, `useAuth.js` | 7 |
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
| 1 | **A live write at full scale** | The write path is proven (see Live status), but the largest real reorder so far is a small playlist. A 414-track run would exercise rate limiting and a long snapshot chain, neither of which has been seen live. Undo and mid-run cancel are also unexercised |
| 2 | Resuming an interrupted run | The undo snapshot is written and restorable, but "a tab died mid-run" detection on next load is not wired |
| 3 | Dry-run detail | Reports a count; does not list the operations |
| 4 | YouTube Music, cross-service sync | See [ROADMAP.md](ROADMAP.md) |

---

## Before the app can talk to Spotify

### The Premium requirement is on creating the app, not using it

Spotify now requires a Premium account to create a Web API app in the
developer dashboard. It does **not** follow that a user of that app needs
Premium: the endpoints this product uses — profile, playlist list, playlist
tracks, reorder, create — have never been Premium-gated. Premium is required
for the Web Playback SDK and for player control (`/me/player/*`), neither of
which this app touches.

So the arrangement in use — a Premium friend owns the app and adds this
account under User Management — is the normal shape for a Development Mode
app, and should work. It is not *confirmed* until a real authorization
succeeds; that is the one thing nothing here can prove without trying.

Worth knowing about that arrangement:

- **Nothing of yours reaches the app owner.** PKCE issues tokens to this
  browser and there is no server, so the friend owns the registration, not
  the data. They can see the app exists; they cannot see your playlists.
- **The Client ID is not a secret.** PKCE uses no client secret, so sharing
  the ID is fine.
- **Access depends on their app.** If they delete it or remove the user, this
  stops working. Nothing here can recover from that except registering
  another app.
- **User Management matching is exact.** The friend must add the full name and
  the email on the Spotify account. A mismatch fails at the consent screen
  with "User not registered in the Developer Dashboard", not with anything
  this app can explain.

### The redirect URI

Register exactly:

```
http://127.0.0.1:5173/
```

Trailing slash included. `http://localhost:5173/` is refused — Spotify allows
plain http only for **loopback IP literals**, and `localhost` is a hostname
that merely resolves to one, which RFC 8252 treats as hijackable.

The trap this creates: Vite prints `localhost` by default, and the app derives
its redirect URI from the origin it is served on. Register `127.0.0.1`, open
`localhost`, and Spotify refuses the handshake on its own error page. Two
guards now exist, so this should not be reachable:

- `vite.config.js` binds `127.0.0.1` with `strictPort`, because a silent
  fallback to 5174 changes the origin and breaks the match the same way.
- The Connect screen checks its own origin, names the address to use instead,
  and disables the button when the current one cannot work.

### Confirmed working

The consent screen has been reached and accepted with a Client ID from an app
owned by another account, with this account added under User Management. So
the borrowed-app arrangement is settled, not theoretical: **the Premium
requirement is on creating the app, and does not extend to using it.** The
four requested scopes are exactly the four the app declares.

### Spotify moved the playlist contents endpoint

Found on the first live run, from the app's own request log. The playlist
object returned by `/me/playlists` carries its track count as **`items.total`**,
not `tracks.total`, and advertises its contents at
**`/playlists/{id}/items`**. The older `/playlists/{id}/tracks` answers `403
Forbidden` for this app.

Both symptoms had one cause: every playlist read as 0 tracks because the
count was read from a field that no longer exists, and opening one failed
because the endpoint had moved. Reads and writes now target `/items`, kept in
`src/services/spotify/endpoints.js` so a path Spotify has moved once can be
moved again in one place. The count reads `items.total` and falls back to
`tracks.total`.

### One bug the test suite could not have caught

The first live attempt hung on "Connecting" after a successful consent. Cause:
React StrictMode mounts, unmounts and remounts in development; the callback
effect cleared the query string as soon as it read the code, so the second
invocation found nothing, and a `cancelled` flag set by the simulated unmount
threw away the first invocation's successful token exchange. The
authorization code is single-use, so the attempt was spent.

The callback now runs exactly once per page load, guarded on a ref, and its
result is not discarded. Verified by instrumenting both counters against the
live dev server: `effectRuns=2, resumeRuns=1`.

Worth remembering: 278 tests did not catch this and could not have. It is a
React lifecycle interaction with a single-use credential, reachable only by
running the real flow. The same is true of the `fields=` projection on the
track fetch and of any real rate-limit behaviour — all of it is tested against
mocks and nothing else.

### What failure looks like

| Symptom | Cause |
|---|---|
| `INVALID_CLIENT: Invalid redirect URI` | Registered URI does not match the origin exactly — check the trailing slash and `127.0.0.1` vs `localhost` |
| "User not registered in the Developer Dashboard" | Name or email in User Management does not match the Spotify account |
| 403 on the first API call after connecting | Scope or account restriction; the app surfaces Spotify's own message |

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
