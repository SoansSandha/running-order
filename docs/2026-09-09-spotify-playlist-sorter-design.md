# Spotify Playlist Sorter — Design

**Date:** 2026-09-09
**Status:** Approved — implementation started

---

## 1. Context

A browser app that connects to a Spotify account, lists the playlists it is
allowed to edit, and rewrites their track order using one of several sort
strategies — either in place, or into a fresh cloned playlist. It also accepts
a CSV and reorders a playlist to match it.

The repository begins as a stock Vite + React 19 template (JavaScript, Oxlint,
no TypeScript, no git history). Nothing app-specific exists yet.

### Goals

- Connect to Spotify with credentials the user supplies at runtime.
- List playlists, distinguishing editable from read-only.
- Offer a set of sort strategies, including an artist-grouped sort.
- Reorder a playlist in place, or clone it and sort the copy.
- Accept a CSV and reorder a playlist to match its row order.
- Never destroy a playlist without a preview and an undo path.

### Non-goals

- Public multi-tenant deployment (see Platform constraints — 25-user cap).
- Editing Liked Songs, which the API does not expose as a reorderable list.
- Copying playlist cover art.
- Any audio-analysis-derived sort (see Platform constraints).

---

## 2. Platform constraints

These are properties of the Spotify platform, not of our design. They bound
what the app can be.

| Constraint | Consequence |
|---|---|
| There is no "API key" that authorises playlist writes | Auth is OAuth 2.0 Authorization Code + PKCE. The user supplies a **Client ID** from the Spotify Developer Dashboard; the app performs the consent redirect |
| Unreviewed apps sit in **Development Mode** | Capped at 25 manually-added users. Fine for personal use; a hard wall for public distribution |
| `/audio-features` and `/audio-analysis` were cut off for new apps in Nov 2024 | No sort by tempo, energy, danceability, key, or valence. These are the variants users most often expect, so the UI should not imply they exist |
| `localhost` is no longer accepted in redirect URIs | Development must register the loopback IP literal `http://127.0.0.1:5173/`. Any deployment must be HTTPS |
| Refresh tokens rotate on every use | Each refresh must overwrite the stored token. Missing this makes the app fail silently about an hour after login |
| Reorder responses carry a new `snapshot_id` | Write operations are strictly sequential; they cannot be parallelised |

---

## 3. Decisions

Settled during design. Each records the alternative rejected, so a future
change is a decision rather than a rediscovery.

| # | Decision | Rejected alternative | Why |
|---|---|---|---|
| D1 | **Pure client-side SPA**, no server | Thin Node backend; Node CLI | See Alternatives considered |
| D2 | Artist-grouped sort ships **both inner comparators** (date-added and release-date) behind a toggle, defaulting to date-added | Picking one | Both fields arrive free in the same fetch; it is one comparator swap, not extra API work |
| D3 | CSV **reorders only** — never adds or removes tracks | Reorder + add missing; full two-way sync | Adding requires a Spotify search layer plus a disambiguation UI, which is the expensive half of the feature. Reorder-only cannot destroy anything |
| D4 | In-place writes use **move operations**, preserving `added_at` | Bulk replace | Bulk replace resets every `added_at` to now, which permanently destroys the data the date-added comparator reads. Sort once and that comparator is meaningless forever after |
| D5 | Redirect URI is the **app root**, not a `/callback` path | A routed callback page | Removes the need for a router library entirely |
| D6 | **PapaParse** is the only added runtime dependency | Hand-rolled RFC 4180 parser | Hand-rolling is the false economy that costs a day on a BOM and a quoted comma |
| D7 | Audience is **the author alone** | Sharing with a few people; public release | Keeps the Connect screen terse rather than a tutorial, and sidesteps the Development Mode 25-user cap entirely |
| D8 | Desktop and mobile are **equally designed** | Desktop-only, with a mobile fallback | The before/after diff needs two real designs — a side-by-side and a genuinely good single-column form — not one squeezed into the other |
| D9 | Track lists are **windowed** from the start | Plain rendering, revisited if it slows down | Playlists run to ~400 today but are expected to grow. Windowing later means rewriting the preview, the surface most expensive to change |

---

## 4. Alternatives considered

Recorded for revisiting. D1 selected Approach A.

### Approach A — Pure client-side SPA (**selected**)

Vite + React as scaffolded, PKCE, no server. PKCE requires no client secret, so
there is nothing to protect and nothing to host beyond static files. The Client
ID is entered on the first screen and remembered in `localStorage`, which means
anyone with their own Spotify dev app can run the tool without touching the
author account. Sorting is a pure function over data already in memory; the
only server-shaped concern is a rate-limit-aware request queue, which is a
small amount of browser code.

### Approach B — Thin Node backend + React frontend

The backend performs the token exchange and proxies API calls. Gains: refresh
tokens never reach the browser, and a long reorder job could survive the tab
closing. Costs: a second deploy target, secret management, CORS, and a
two-process dev setup.

**Revisit if:** the app needs to be distributed to users who should not have to
register their own Spotify application; or reorder jobs grow long enough that
surviving a closed tab matters more than a resumable undo snapshot does.

### Approach C — Node CLI

Authenticates once via the browser, then runs entirely in the terminal. By far
the fastest to build, with no UI work at all. Rejected because the before/after
preview is what makes an irreversible reorder feel safe, and a terminal cannot
show it well.

**Revisit if:** the sort engine proves valuable enough to want in scripts or
scheduled jobs. The pure `sort/`, `csv/`, and `plan/` layers are deliberately
free of any browser or React dependency, so a CLI could reuse them unchanged.

---

## 5. Architecture

### 5.1 Module map

Four pure layers with no network access, wrapped by two that have it. This
split is the central structural idea: everything likely to be subtly wrong is a
pure function over plain arrays, and therefore testable without a network.

```
src/
  auth/     pkce.js · spotifyAuth.js · useAuth.js
  api/      client.js · queue.js · playlists.js · mutations.js   <- network
  model/    track.js            normalize Spotify item -> Track
  sort/     comparators.js · strategies.js · artistGrouped.js    <- pure
  csv/      parse.js · detectColumns.js · match.js · order.js    <- pure
  plan/     diff.js · undo.js   target order -> move ops         <- pure
  ui/       screens/ · components/                               <- React
```

`sort/`, `csv/`, and `plan/` must never import from `api/`. They take arrays
and return arrays. This constraint is worth enforcing in lint.

### 5.2 Data model

One normalized `Track`, built once at fetch time, carrying every field any
comparator might want — so no strategy needs a second round trip:

```
id · uri · name · artists[] · primaryArtist · artistSortKey
album{name, releaseDate, precision} · releaseDateSortable
durationMs · popularity · explicit · trackNumber · discNumber · isrc
addedAt · originalIndex · isLocal · isUnavailable · isEpisode
```

`artistSortKey` is the display name lowercased, NFD-stripped of diacritics,
with a leading `the ` dropped. Artist *identity* for grouping uses the artist
**ID**, so "Beyoncé" and "Beyonce" resolve to one block rather than two.

`releaseDateSortable` normalises Spotify variable precision — `release_date`
may be `1972`, `1972-03`, or `1972-03-01` — by padding to `YYYY-MM-DD` so
string comparison is valid.

#### Edge cases present in real playlists

| Case | Reality | Handling |
|---|---|---|
| Unavailable track | `item.track` is `null`; occupies a position, has no URI | Sorts to the bottom in original relative order. Cannot be cloned — reported, never silently dropped |
| Local file | `is_local: true`, URI is `spotify:local:…` | Reorders correctly in place; **cannot** be added to a clone. Reported |
| Podcast episode | No `artists` field at all | Trailing group, keyed by show name |
| Duplicate track | Same URI at several positions | Handled, because all operations address **indices**, never URIs. A further reason D4 chose move-based writes |

### 5.3 Auth

The redirect URI is the app root. On load the app checks for `?code=`,
exchanges it, and clears the query string with `history.replaceState`.

- Code verifier and `state` live in `sessionStorage`.
- The refresh token lives in `localStorage` and is overwritten on every
  refresh, because Spotify rotates it.
- The access token is held in memory, refreshed proactively 60s before expiry.
- Scopes: `playlist-read-private`, `playlist-read-collaborative`,
  `playlist-modify-public`, `playlist-modify-private`.

The Connect screen displays the exact redirect URI with a copy button. A
mismatch is the most common setup failure, and Spotify reports it on its own
error page — the app never gets the chance to explain.

### 5.4 Fetch layer

`client.js` injects the bearer token and converts failures into typed errors:

| Status | Behaviour |
|---|---|
| 429 | Read `Retry-After`, wait, retry |
| 401 | Refresh once, retry once, then surface `AuthError` |
| 5xx | Three attempts, exponential backoff |

Reads run at ~4 concurrent. **Writes are strictly sequential** — each reorder
returns a `snapshot_id` the next call depends on.

Track fetches use a `fields=` projection restricted to the model properties
above, which roughly halves the payload on large playlists. Pagination is 50
per page for playlists, 100 for tracks.

A playlist is editable when `owner.id === me.id || collaborative === true`.
Others are listed but badged clone-only.

---

## 6. Sort engine

A strategy registry, not a switch statement. Each entry declares an id, label,
description, its option schema, and a comparator factory.

One deliberate collapse: "sort by artist" and "artist-grouped" are the same
operation with different inner comparators, so there is a single **Artist**
strategy carrying an inner-order option. This yields more usable variants for
less code.

| # | Strategy | Options |
|---|---|---|
| 1 | **Artist** — blocks A→Z, one per artist | inner: date added (default) · release date · album & track no. · title |
| 2 | **Album** — blocks per album | album order: release date (default) · name. Inner: disc + track number |
| 3 | Release date | asc (default) / desc |
| 4 | Date added | asc (default) / desc |
| 5 | Title A→Z | asc (default) / desc |
| 6 | Duration | asc (default) / desc |
| 7 | Popularity | desc (default) / asc |
| 8 | Shuffle | seeded from a string, reproducible and shareable |
| 9 | Reverse current | none |
| 10 | CSV order | file + column mapping |

Every comparator chain terminates in `originalIndex`, making sorts explicitly
stable rather than relying on the engine's stability by accident.

Shuffle uses a mulberry32 PRNG seeded from a hash of a user-supplied string
(default: today's date), so the same seed always produces the same permutation.

### 6.1 The artist sort

```
1. Bucket by artists[0].id        fallback: normalized name, for local files and episodes
2. Sort within each bucket        chosen inner comparator, then album, disc, track, originalIndex
3. Sort buckets by artistSortKey  localeCompare with numeric: true
4. Concatenate buckets
5. Append trailing groups         episodes, then unavailable tracks in original relative order
```

Buckets are ordered A→Z. Ordering by bucket size or by earliest-added are each
a three-line comparator if wanted later, but are not built now.

**A track files under its primary artist only.** A Drake × Rihanna track sits
in Drake's block, never in both. This is not a preference: a reorder is a
permutation, so a track cannot occupy two positions. Track count is invariant
by construction.

---

## 7. CSV pipeline

### 7.1 Parse and detect

PapaParse handles the file (D6). Column detection then runs header heuristics,
case- and space-insensitive:

| Field | Header patterns | Value signature |
|---|---|---|
| URI / ID | `uri`, `track uri`, `spotify uri`, `id`, `track id`, `url`, `link` | `spotify:track:[A-Za-z0-9]{22}` or `open.spotify.com/track/…` |
| ISRC | `isrc` | 12-char alphanumeric |
| Title | `track`, `track name`, `title`, `song`, `name` | — |
| Artist | `artist`, `artists`, `artist name`, `album artist` | — |
| Album | `album`, `album name` | — |

Detection results pre-fill a manual column-mapping UI, which is always
available and required for headerless files. Exportify output
(`Track URI, Track Name, Artist Name(s), …`) should detect cleanly.

### 7.2 Matching

Tiered. The first tier producing a unique match wins.

| Tier | Key | Auto-applied |
|---|---|---|
| 1 | Track URI / ID exact | yes |
| 2 | ISRC exact | yes |
| 3 | Normalized title + normalized primary artist | yes |
| 4 | Normalized title + any credited artist | yes |
| 5 | Title similarity ≥ 0.9 (Dice coefficient on bigrams) + artist match | **no — suggestion requiring confirmation** |

Match normalization lowercases, NFD-strips diacritics, removes bracketed
suffixes (`(feat. X)`, `[Remastered 2011]`, `- Radio Edit`), and collapses
punctuation and whitespace. Both raw and normalized forms are retained so the
report can display the original text.

Duplicates pair greedily from a per-key pool: two CSV rows against a single
playlist copy leaves the second row honestly unmatched, rather than
double-assigning.

### 7.3 Target order

- Matched playlist tracks take positions in CSV row order.
- Playlist tracks with no CSV row move to the **bottom**, preserving their
  original relative order. A top/bottom option is offered; bottom is default.
- CSV rows with no playlist match are reported only. Nothing is added (D3).

### 7.4 Reconciliation report

Shown before anything is written. This is the answer to matching song counts.

```
CSV rows                     312
Playlist tracks              298
Matched                      289    URI 240 · ISRC 31 · title+artist 18
Needs review (fuzzy)           4    accept / reject each
CSV rows with no match        19    listed
Playlist tracks not in CSV     9    listed, moved to bottom
Duplicate CSV rows             2    listed
```

---

## 8. The move algorithm

### 8.1 Minimising moves

The naive approach walks each target position and moves the correct track
there, costing up to *n* sequential calls.

Instead: read each target track's *current* position, in target order, giving a
sequence `P`. Take the **longest increasing subsequence** of `P`. Those tracks
are already in correct relative order and never need to move. Moving only the
remainder costs `n − |LIS|` operations, which is the proven minimum under
single-item moves.

The payoff is re-runs. Re-sorting after adding five songs costs roughly five
moves, not five hundred.

### 8.2 Index arithmetic

Every move shifts everything after it, and Spotify expresses `insert_before` in
*pre-removal* indexing. Given a desired final index `to` and current index
`from`:

```js
insert_before = to > from ? to + rangeLength : to
```

The executor keeps a local mirror of server state in lockstep, recomputing each
operation from the mirror rather than from the original array:

```js
const [item] = model.splice(from, 1)
model.splice(to, 0, item)
```

Getting this subtly wrong scrambles a real playlist, which is why it carries
the strongest test in the codebase (§10).

**Future optimisation, not built now:** consecutive target items that are also
consecutive in the mirror can move together with `range_length > 1`. LIS
already captures most of the available saving.

---

## 9. Execute, undo, clone

### 9.1 Safety before writes

An undo snapshot — `playlistId`, `playlistName`, `snapshotId`, ordered URIs,
timestamp — is written to `localStorage` and offered as a JSON download before
any mutation.

`snapshot_id` is re-checked immediately before execution. If the playlist
changed underneath us, abort and re-preview rather than write into a moved
target.

Cancellation is safe at any point: a half-sorted playlist is still a valid
playlist, and undo remains available. A tab that dies mid-run is detected on
next load, offering resume or rollback.

### 9.2 Clone-and-sort

Skips the move algorithm entirely: create the playlist, then bulk-add in
100-URI chunks — seconds rather than minutes.

`POST /users/{me}/playlists`, named `"{original} (sorted by {strategy})"`,
private by default, description recording source playlist, strategy, and date.

A clone **can** legitimately contain fewer tracks than its source: local files
and unavailable tracks have no addable URI. This is stated in the preview, not
discovered afterwards. Cover art is not copied (out of scope, §1).

---

## 10. Testing

Vitest, which needs no configuration in a Vite project. The layer split of §5.1
exists precisely so the risky code needs no network.

| Target | Test |
|---|---|
| `plan/diff` | **Property:** for randomized permutations, replaying generated ops against a plain array reproduces the target exactly |
| `sort/` | **Property:** output is always a permutation of input — same length, same URI multiset |
| `sort/` | Fixture playlist (~40 tracks with duplicates, collaborations, an unavailable track, a local file, an episode) → exact expected order per strategy |
| `csv/` | Fixtures: Exportify export, headerless, quoted commas, BOM, CRLF, duplicate rows, unmatched in both directions |
| `api/` | Mocked fetch: 429 backoff, 401 refresh-once, pagination assembly |

No end-to-end tests against the live API. Instead a **dry-run mode** logs the
operation list without sending it, for verification against a throwaway
playlist before trusting the tool with a real one.

---

## 11. Error handling

| Failure | Handling |
|---|---|
| Redirect URI mismatch | Spotify reports this on its own page and may never redirect back. Mitigated preventively: the Connect screen shows the exact URI with a copy button |
| `?error=` on return | Parsed and explained in plain language |
| Token expiry mid-job | Transparent refresh, job resumes |
| 429 mid-job | Pause, show "rate limited, resuming in Ns", auto-resume |
| 403 on write | Playlist not editable. Checked up front so it fails before any work |
| Playlist changed underneath | `snapshot_id` mismatch → abort, re-fetch, re-preview |
| Local / unavailable tracks | Surfaced in preview, never silently dropped |

---

## 12. UI flow

| Screen | Contents |
|---|---|
| **Connect** | Client ID input, exact redirect URI with copy button, setup steps, Connect |
| **Playlists** | Name, cover, track count, owner, editable badge, search filter. Read-only playlists badged clone-only |
| **Sort** | Strategy list with descriptions; options panel for the selected strategy; CSV upload and column mapping when relevant. Actions: Sort in place · Clone and sort |
| **Preview** | Before/after with move indicators, counts of tracks moving, API calls, estimated time, plus the CSV reconciliation report. Confirm |
| **Progress** | Progress bar, current operation, cancel. Then: done · undo · open in Spotify |

---

## 13. Build order

Sequenced by risk rather than feature size.

| Phase | Deliverable |
|---|---|
| 1 | Auth + playlist list — the highest-risk unknown is dashboard configuration and redirect URI |
| 2 | Fetch + normalize + sort engine — pure, fully tested, still zero writes |
| 3 | Preview + diff algorithm — every sort visible before anything is destructible |
| 4 | Execute in place + undo — first writes, behind the preview from phase 3 |
| 5 | Clone-and-sort — reuses the bulk-write path |
| 6 | CSV — most self-contained, and smallest given D3 |

Phases 1–3 constitute a working read-only tool that shows what it would do — a
useful checkpoint before enabling writes.

**Implementation note:** phases 2 and 3 were built before phase 1, because the
pure layers are verifiable by test immediately, whereas auth cannot be verified
until a Client ID and redirect URI are registered.
