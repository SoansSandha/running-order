# YouTube Music Mirror — Design

**Date:** 2026-09-18
**Status:** Approved 2026-09-20
**Supersedes:** the "Phase 2 / Phase 3" sketch in [ROADMAP.md](ROADMAP.md)

Builds on [2026-09-09-design.md](2026-09-09-design.md), whose decisions D1–D9
still hold except where noted. Product truth: [../PRODUCT.md](../PRODUCT.md).

---

## 1. What this is

Spotify stays canonical. Sorting happens there, against full metadata, exactly
as it does today. A YouTube Music playlist can then be **made to match** it:
tracks it is missing are added, and it is reordered into Spotify's sequence.

This replaces the earlier plan of "YouTube Music as a second sortable
source" — but not entirely. YouTube can still be sorted on its own, with the
strategies its metadata actually supports. Three modes:

| Mode | What runs |
|---|---|
| **Spotify only** | All nine strategies. Unchanged from today |
| **YouTube only** | The five its metadata supports, plus a degraded album sort. The other three are visibly disabled, with the reason stated |
| **Sync** | Sort Spotify → fill YouTube's missing tracks → *optionally* reorder YouTube to match |

### Why the scope changed

The spike established that YouTube Music does not carry the data the sorts
need. Confirmed against the documented `get_playlist` response, not inferred: a
track carries `videoId`, `setVideoId`, `title`, `artists`, `album`,
`duration_seconds`, `isAvailable`, `isExplicit`, `videoType`, `likeStatus`,
`inLibrary` — and no date, no track number, no release year.

| Sort | On YouTube Music natively |
|---|---|
| Artist · Title · Duration · Shuffle · Reverse | Works |
| Album | Badly degraded — no track number, *and* `album` is absent on 40% of tracks (measured: present on 228 of 379 in the real library). Anything sourced from a music video or a user upload carries no album at all |
| **Date added** | **Absent.** It is the default inner order for the artist sort |
| Release date | Absent — no per-track release year |
| Popularity | No equivalent |

The artist sort therefore survives on YouTube with two of its four inner
orders: album name and title, not date added or album release date.

Making Spotify canonical dissolves all of it *for the sync path*: YouTube
never has to answer a question it cannot answer. The YouTube-only path keeps
the gaps, and states them rather than hiding them — Product Principle 4.

### What that removes

Two things designed and then deleted, recorded so nobody rebuilds them:

- **The album-enrichment pass** (`get_album()` per distinct album to recover
  track number and release year). Only existed to make YouTube sortable.
- **The YouTube Data API entirely.** It was in scope solely to supply
  `playlistItems.snippet.publishedAt` — a genuine, exact date-added, joinable
  on `videoId` for about 9 quota units per playlist. Real and cheap, and
  explicitly declined (D21): date-added is wanted on Spotify, where it already
  works, and not on YouTube. If that ever changes, this is the way back — but
  it would first need confirming that a YouTube *Music* playlist id even
  resolves in the Data API, which has not been tested.

### What it does not remove

Mirroring an order onto YouTube requires knowing **which YouTube track is
which Spotify track**. There is no shared identifier. So cross-service
matching is not deferred work — it is the centre of this design.

---

## 2. Decisions

Continuing the numbering in the original design doc.

| # | Decision | Rejected | Why |
|---|---|---|---|
| D10 | **Spotify is canonical *for sync*.** When both are linked, Spotify decides the order | Treating the two as peers and merging both ways | YouTube Music lacks the metadata half the strategies need, so a two-way merge would have to invent an order it cannot justify. One direction also means one undo model and one mental model. YouTube still sorts standalone (D20) — it just never dictates the order in a sync |
| D11 | **`ytmusicapi` (Python) via a local proxy** | Official Data API; `libmuse` (JS) | The Data API returns *video* metadata — no album, no track number, no artist field — so the flagship sort is not implementable on it, and writes cost 50 quota units each against a 10,000/day cap. `ytmusicapiJS` is archived since June 2023; `libmuse` self-describes as "not ready for production use" and its reorder support could not be confirmed |
| D12 | **A local proxy process, not a hosted service** | Browser-direct; a deployed backend | YouTube Music sends no CORS headers, so a browser cannot call it. A proxy bound to `127.0.0.1` keeps D1's actual value — no hosting, no deploy target, nobody else holding credentials. This is the narrow, named exception to D1 |
| D13 | **The proxy holds no business logic** | A richer service layer | Every decision stays in JS where 291 tests already live. Adding a Python process must not open a hole in coverage |
| D14 | **Spotify keeps talking to its API directly** | Routing both through the proxy | The Spotify path works, is tested, and needs no secret. Routing it through the proxy would add a failure point and make the proxy a hard dependency for Spotify-only use |
| D15 | **Nothing auto-applies except a prior human confirmation** | Auto-applying strong matches | Within one service a URI match is a fact. Across services there is no identifier, so every match is a proposal. A wrong match does not look wrong — it silently misfiles a track |
| D16 | **Rejections are remembered, not just confirmations** | Storing only positives | Otherwise a pair you dismissed is re-proposed on every sync forever. This decides whether the tool is liveable |
| D17 | **Nothing is ever deleted from YouTube** | Making YouTube exactly match Spotify | A missing or wrong match would delete a track the user wanted, and YouTube offers no snapshot to restore from |
| D18 | **Borrowing metadata across services is gated on confirmation** | Using Spotify data to fill YouTube gaps freely | Sorting by a borrowed field makes the ordering rest on a guess, invisibly. After a pair is confirmed it is no longer a guess, and borrowing is then legitimate |
| D19 | **Adding missing tracks to YouTube is in scope**, one direction only | Reorder-only, as D3 confined the CSV | "Sync" means little if the two playlists never converge in *contents*. D3 refused membership changes because adding needs a search layer and a disambiguation UI — both of which 2b builds anyway. It stays one-directional because writing to Spotify from a guess would compromise the canonical list (D10) |
| D20 | **YouTube sorts standalone, with a per-source capability registry** | Dropping the mode; or offering all nine and letting three fail | Five strategies work on YouTube's metadata and a sixth degrades honestly. Dropping them would remove working functionality; offering all nine would put controls on screen that quietly do nothing, which Product Principle 4 forbids. So each source declares what it supports and the UI disables the rest with the reason visible |
| D21 | **No YouTube Data API** | Adding it back to recover date-added | Date-added is wanted on Spotify, where it already works. It is not wanted on YouTube, so the one field the Data API would recover has no user behind it. Declined on need, not on cost |
| D22 | **Browser credentials, not OAuth**, for YouTube | ytmusicapi's OAuth flow | Google expires refresh tokens after 7 days for any External app in Testing status, and `youtube` is not an exempt scope. Publishing to Production requires a home page, privacy policy and verifiable authorised domain — a local single-user tool has none. Browser credentials need no Google Cloud project and last ~2 years. See §5 |

---

## 3. Sequencing

Three deliverables. Each proves what the next depends on, and each is
independently verifiable.

| | Deliverable | Proves | Writes? |
|---|---|---|---|
| **2a** | Service boundary, proxy, YouTube auth, YouTube read-only | The seam, auth, and the adapter work | None |
| **2b** | Cross-service matching and the confirmation surface | The hard problem | None |
| **2c** | Mirror execution — fill, then order | Writes, preview, undo | Yes |

The three modes are not a fourth deliverable. **Spotify-only** exists today.
**YouTube-only** falls out of 2a plus the capability registry (D20) — the
sort strategies already operate on a normalized `Track`, so once YouTube reads
and writes, sorting it standalone is capability-gating and UI wiring, not new
algorithm. **Sync** is 2b and 2c.

Building 2b before any write path exists is deliberate. Matching is where
this succeeds or fails, it is pure functions plus a review screen, and it is
fully testable without touching YouTube.

### Two halves, not one

"Make YouTube match Spotify" is two operations, and only the second is a
reorder:

1. **Fill** — a Spotify track with no YouTube counterpart gets searched for
   and added.
2. **Order** — the playlist is reordered to Spotify's sequence.

Fill is a **membership change**, the category D3 deliberately confined the
CSV away from. It is in scope here because it is the half that makes "sync"
mean anything, and because the confirmation surface built in 2b is exactly
the disambiguation UI whose absence made it unsafe before. It is not a second
mechanism: a search result is a *candidate*, scored and confirmed through the
same tiers and the same screen as a match found in the playlist.

---

## 4. The service boundary (2a)

### Coupling that exists today

Verified, not assumed:

- `plan/execute.js` and `plan/clone.js` **import `api/mutations.js` directly**
- `csv/detectColumns.js` and `csv/match.js` **hardcode Spotify URI patterns**

Only `sort/` and `model/` are genuinely service-agnostic.

### Target layout

```
src/services/
  spotify/      ← today's api/ + auth/spotifyAuth.js, behaviour unchanged
  youtube/      ← client for the local proxy, adapter to Track
  registry.js   ← { id, label, connect, listPlaylists, fetchTracks, writer }
```

`plan/execute.js` stops importing Spotify and takes a **writer** instead:

```js
executeReorder({ writer, playlistId, currentTracks, targetTracks, ... })
```

This is a refactor of working code. It runs with the full suite green at
every step; no behaviour changes, only a seam is introduced.

### The neutral move operation

`plan/diff.js` internally computes *"place this track immediately after the
previously-placed one"*, then converts that to Spotify's pre-removal index
arithmetic. YouTube's `edit_playlist(moveItem=(a, b))` — move item `a` before
item `b`, both `setVideoId` — **is that native form**.

So `diff.js` gains a second exported function returning the neutral op:

```js
{ key, beforeKey }   // beforeKey === null means "to the end"
```

`beforeKey` rather than `afterKey` deliberately: `edit_playlist`'s documented
contract is *"move one item before another"*, so this form is a 1:1 pass
through to YouTube with no arithmetic, and the conversion work is confined to
the Spotify adapter where the index juggling already lives and is already
tested.

The existing index-based export stays, unchanged and still tested, and
Spotify's writer becomes one adapter of the neutral form rather than the
algorithm's assumed output.

---

## 5. The proxy

Python, FastAPI, bound to `127.0.0.1`, CORS-locked to the Vite origin.
Started alongside Vite by `npm run dev`.

| Route | Purpose |
|---|---|
| `GET /auth/status` | Whether a Google credential is present |
| `POST /auth/status` | Whether stored browser credentials still authenticate |
| `GET /playlists` | The user's playlists |
| `GET /playlists/{id}` | Its tracks |
| `GET /search` | Song search — candidates for the fill half |
| `POST /playlists` | Create |
| `POST /playlists/{id}/items` | Add, in order |
| `PATCH /playlists/{id}/order` | One move: `{ setVideoId, beforeSetVideoId }` |

**The proxy owns the Google credential.** It is stored in a local file beside
the proxy; the browser never holds it. That is better than the Spotify side,
not worse.

Per D13 the proxy translates and authenticates, nothing more. It does not
decide order, match tracks, rank search results, or batch. `GET /search`
returns candidates in YouTube's own order; every judgement about them is made
in JS.

### Verified call-level constraints

Confirmed against the library, not assumed. Each of these is silent when got
wrong, which is why they are recorded here rather than left to discovery:

| Constraint | Consequence if missed |
|---|---|
| `get_playlist(limit=...)` truncates by default | Measured against the real 379-track playlist: the default returned **200**, not the 100 the signature suggests — it reads whole pages. Either way it truncates. The proxy always passes `limit=None` |
| `trackCount` can exceed the items returned | Measured: `trackCount` 382, items returned 379, stable across three fetches. Three items are counted by YouTube but never returned. See "Items that cannot be read" below |
| A playlist carries a display `sortOrder` (`MANUAL` / `NEWEST_FIRST` / `NEWEST_LAST` / `TOP_VOTED`) | If it is not `MANUAL`, a manual reorder may not be what is displayed. Checked before ordering, and surfaced rather than silently changed |
| `add_playlist_items(..., duplicates=False)` | The library's own double-add guard. Used, as a second line behind our own |
| Browser credentials carry session cookies | Full account access — more sensitive than a client secret. Proxy-held, never served to the page |

### Authentication: browser credentials, not OAuth (D22)

`ytmusicapi` offers two methods. We use **browser authentication** — request
headers copied once from a logged-in `music.youtube.com` session, stored as
`browser.json`.

The OAuth route was attempted first and abandoned on evidence. It needs a
Google Cloud project and a "TVs and Limited Input devices" client, and Google
issues **refresh tokens that expire after 7 days** for any External app whose
publishing status is Testing. `youtube` is not in the exempt scope set, so the
only fix is publishing to Production — which requires a home page, a privacy
policy URL, and a verifiable authorised domain. A local single-user tool has
none of those, so OAuth means re-authorising weekly, forever.

Browser credentials last roughly two years while the session stays valid, and
need no Google Cloud project at all.

| | OAuth | Browser auth |
|---|---|---|
| Google Cloud project | Required | None |
| Lifetime | 7 days unless published | ~2 years |
| Publishing prerequisites | Domain + privacy policy | — |
| Playlist editing | Yes | Yes |

The trade is threefold: a fiddlier one-time setup (copying headers out of
devtools), credentials that die if the user signs out of YouTube Music, and
**ytmusicapi labels browser auth "deprecated"** in its CLI help.

That last one was checked rather than assumed. As of 1.12.3 it is a soft
deprecation: `ytmusicapi/auth/browser.py` is fully present and wired, and no
`DeprecationWarning` is raised — unlike `subscribe_artists`, which does raise
one. It is a nudge toward OAuth, not a scheduled removal.

Two mitigations, because "soft today" is not "safe forever":

- **Pin `ytmusicapi` to an exact version** in the proxy's `requirements.txt`,
  so an incidental upgrade cannot remove the auth method underneath a working
  install.
- **D13 contains the blast radius.** The proxy holds auth and transport and
  nothing else, so if browser auth is eventually removed, the change is
  confined to the proxy's auth call. No JavaScript moves, and no test changes.

If Google's publishing requirements ever become satisfiable for this project —
a domain with a privacy policy — OAuth becomes the better long-term choice and
this decision should be revisited.

**This does not weaken D12.** CORS was always the primary reason a local
process is required, and that is unchanged. It sharpens the credential
argument rather than removing it: session cookies are *more* sensitive than a
client secret would have been, and they now never reach the browser at all.

### When the proxy is not running

Spotify-only use must not degrade. The app probes `/auth/status` once, and a
proxy that is absent or unreachable disables the YouTube panel with a plain
explanation — it never blocks startup, never retries in a loop, and never
turns a Spotify sort into an error. This follows from D14: Spotify talks to
its own API directly and has no dependency on the proxy.

---

## 6. Track model

`Track` gains two fields, both null for Spotify today:

| Field | Meaning |
|---|---|
| `source` | `'spotify'` or `'youtube'` |
| `itemId` | The playlist-item identity a write needs. YouTube: `setVideoId` |

`id` carries the *track* identity — the Spotify track id, or the YouTube
`videoId`. The two are deliberately separate fields because they have
different lifetimes: `id` is stable, `itemId` is reissued whenever the
playlist's membership changes. §11 depends on that distinction.

**`setVideoId` is safe to key a reorder on.** Measured against the real
379-track playlist: present on 379 of 379 rows, and **379 distinct values for
379 rows**. That is structural rather than lucky — `setVideoId` identifies a
playlist *item*, so two copies of the same song carry different ones, which is
exactly the property `videoId` lacks and `diff.js` requires. The adapter must
still refuse a row whose `setVideoId` is null rather than key on it, because
`null` is the `beforeKey` end-of-list sentinel (§4).

### Items that cannot be read

The real playlist reports `trackCount` 382 while returning 379 items,
consistently. Three items are counted and not returned — most likely fully
deleted videos. They are not the unavailable ones: all five unavailable tracks
*are* returned, with both ids intact.

This is a "never lose a track" problem, so it gets stated rather than
absorbed: **the count difference is surfaced before any write** — *"YouTube
reports 382 items; 379 could be read. 3 cannot be read and will not be
touched."* Unreadable items are never counted as YouTube-only extras, never
sunk, and never included in a move plan, because an item we cannot see is one
we cannot reason about.

A YouTube track normalizes into the same shape as a Spotify one, with the
absent fields honestly empty rather than invented: no `addedAt`, no
`trackNumber`, no `releaseDateSortable`, no `popularity`, no `isrc`.

---

## 7. Matching (2b)

`ytmusicapi` returns **no ISRC**, so there is no identifier tier at all — not
even the weak one the CSV matcher enjoys. Matching rests on title, artist and
duration.

| Tier | Basis | Auto-applied |
|---|---|---|
| **Certain** | Present in the match book with verdict `same` | Yes — a human already confirmed it |
| **Strong** | Exact folded title + primary artist, absolute duration delta ≤ 2s | No |
| **Likely** | Fuzzy title (Dice ≥ 0.9), or any-credited-artist, or duration delta 2–5s | No |
| **Unmatched** | Nothing cleared the floor | — |

A candidate whose duration differs by more than 5 seconds is **not proposed**
at all. That gap usually means a live cut, an extended mix, or a cover — the
match you least want, and the one a title comparison is most likely to make.

### Two sources of candidates, one scorer

| Source | Candidate pool | Produces |
|---|---|---|
| **Pair** | The YouTube playlist's own tracks | A pairing for the order half |
| **Fill** | `GET /search` results for a Spotify track with no pairing | An addition for the fill half |

Both run through the same tier function, because the question is identical:
*is this YouTube track this Spotify track?* Where the candidate came from
changes what a confirmation authorizes, not how it is judged.

Fill search is only run for tracks left Unmatched after pairing, so a track
already in the playlist is never searched for and never added twice.
Pairing is greedy from a pool, as `csv/match.js` already does, so two Spotify
tracks cannot claim the same YouTube track.

`videoType` is used as a tie-breaker: `ATV` is an album audio track and
`OMV` an official music video, so where two candidates are otherwise equal the
audio track wins. It is a tie-breaker only — never a reason to promote or
reject a candidate on its own, because a legitimate match is sometimes only
available as a video.

Title folding reuses `csv/match.js`'s `matchText` unchanged: `(feat. X)` and
remaster tags dropped, `(Live)` and `(Remix)` kept. Cross-service matching is
a harder instance of the same problem, so this extends that module rather
than forking it.

**Nothing below Certain is ever applied without confirmation** (D15).

---

## 8. The match book

A durable local record of human decisions:

```js
{ spotifyId, youtubeVideoId, verdict: 'same' | 'different', decidedAt }
```

Stored in `localStorage` with the same try/catch discipline as undo snapshots
— a blocked store degrades the experience, it never breaks a sync.
Exportable and importable as JSON so it survives a cleared browser.

Rejections are stored (D16). A `different` verdict suppresses that pair
permanently rather than re-proposing it every run.

The second sync of a playlist is then almost entirely Certain, and only
genuinely new tracks need review.

---

## 9. The confirmation surface (2b)

A board screen in the existing vocabulary — two columns, hard rules, amber
pending, green confirmed, red rejected.

```
SPOTIFY                       YOUTUBE                     Δ
Haye Mera Dil            ▶    Haye Mera Dil          ▶   +1s   STRONG   [Confirm]
Alfaaz, Yo Yo Honey Singh     Alfaaz, Honey Singh
```

- Each side links out to play it: `open.spotify.com/track/{id}` and
  `music.youtube.com/watch?v={videoId}`. A doubtful pair costs seconds to
  settle rather than a guess.
- The duration delta is shown as a signed number. It tells the user more than
  a confidence percentage would.
- Rows group by tier, Certain collapsed by default.
- **Confirm-all acts on the Strong group only.** Likely rows always need
  individual attention. That is what makes "good enough" a judgement the user
  can actually make.
- Unmatched on both sides is listed and counted, never silently dropped —
  the same discipline as the CSV reconciliation report.

**Fill rows are marked as additions and grouped separately**, because
confirming one authorizes something different in kind: a pairing confirmation
only affects order, while a fill confirmation puts a new track into the
playlist. They carry their own confirm-all, so accepting every strong
*pairing* never silently adds anything. A fill row offers the top few search
candidates rather than a single one, since the right track is not always
YouTube's first result.

The header states both counts before anything runs — *"38 to reorder, 6 to
add"* — so the size of each half is known in advance.

---

## 10. Mirror execution (2c)

Two modes (both were requested):

**Reorder in place** — the default, and the one that stays useful. The
*order* half is a toggle: fill always runs, reordering is opt-out, so "bring
YouTube up to date but leave my arrangement alone" is a first-class choice
rather than a thing you get by cancelling halfway.

1. Fetch the YouTube playlist.
2. **Fill.** Add every confirmed fill candidate. Additions land wherever
   YouTube puts them; their position is the next phase's problem, not this
   one's.
3. **Re-fetch.** Non-negotiable — see below.
4. **Order.** Target: confirmed pairs in Spotify's sequence, then
   YouTube-only tracks sunk to the bottom keeping their relative order (D17).
   Neutral move ops from `diff.js`, executed one at a time through the proxy.
5. Preview first; progress and cancel throughout.

> **Fill strictly precedes order, with a re-fetch between them.** `setVideoId`
> is a playlist-*item* id, and adding items reissues them. Move ops computed
> before an addition therefore reference ids that no longer exist, and a
> reorder built on them fails or, worse, moves the wrong track. Interleaving
> the two phases is the single most likely way to corrupt a playlist here.

A cancel between phases leaves a playlist that is complete but not yet
ordered — valid, and re-runnable. That is the right failure: a playlist with
every track in the wrong order beats one in the right order missing tracks.

**Create new** — a one-shot export.
1. Create a playlist named after the source.
2. Add confirmed `videoId`s — pairings and fills alike — in Spotify's order.
   No reordering at all, so no `setVideoId` concerns arise.
3. Unmatched Spotify tracks are reported, not silently dropped. YouTube-only
   extras do not arise here, because the source is Spotify.

### Direction

Fill runs **Spotify → YouTube only**. A YouTube-only track is reported and
counted, and sinks to the bottom, but is never pushed into Spotify. Spotify
is canonical (D10), and writing to it from a guessed match would make the
canonical list depend on the thing this whole design treats as uncertain.

Importing YouTube-only tracks into Spotify is a coherent future feature and
an explicit non-goal here. See §14.

---

## 11. Undo, and the pre-write guard

YouTube has no `snapshot_id`. The guard changes shape and ends up stronger:
**re-fetch immediately before writing and compare the actual item list** to
what the preview was built from. Any difference aborts and re-previews.
Comparing content beats comparing a token.

**`setVideoId` is a playlist-item id and changes when items are added or
removed.** The undo snapshot therefore stores stable `videoId`s and
re-resolves `setVideoId`s at restore time. Storing the wrong one produces an
undo that silently does nothing — the worst possible failure for an undo.

### Undoing a fill

Undo has to remove what fill added, which looks like a contradiction of D17.
It is not, and the distinction is worth stating precisely:

- **D17 forbids deleting the user's content** — a track that was in the
  playlist before this tool touched it is never removed, whatever the sync
  decides about it.
- **Undo removes only what this run added**, identified by the explicit list
  of `videoId`s the snapshot recorded at fill time. It reverts our own write.

So the snapshot carries two things: the order before, and the additions made.
Undo removes the additions, then restores the order. A track the user added
themselves between the sync and the undo is not in that list and is therefore
untouched — which is the whole reason the list is recorded rather than
inferred by diffing.

---

## 12. Testing

| Target | Test |
|---|---|
| `diff.js` neutral ops | Property: replaying neutral ops reproduces the target, across random permutations — the same standard the index ops already meet |
| Matching | Adversarial fixtures, not happy paths: live versions, remixes, covers, same title by different artists, duration drift at the 2s and 5s boundaries, one Spotify track with several plausible YouTube candidates |
| Match book | Round trip, `different` suppression, export/import, storage that throws |
| Mirror order | Permutation of the **post-fill** list — same count, same tracks; YouTube-only tracks at the bottom in original relative order |
| Fill/order sequencing | The planner never emits a move op referencing a `setVideoId` from before an addition. Asserted directly, because this is the corruption case and it would not show up as a test failure elsewhere |
| Undo | Removes exactly the recorded additions and no more — including the case where the user added a track by hand between sync and undo |
| Service registry | Both writers satisfy the same contract, exercised against a fake |
| The proxy | Thin by construction (D13). A small `pytest` suite covers auth and translation only |

---

## 13. Risks

- **The Spotify write path is still unproven.** `execute.js` has never
  completed a reorder against the live API, and clone-and-sort returned 403.
  The refactor in 2a extracts a seam from that code — if it carries a bug,
  the refactor preserves it and spreads it to two services. **Proving the
  Spotify write path should come before or alongside 2a.**
- **`ytmusicapi` is unofficial** and can break when Google changes its web
  client. It is actively maintained, so this means occasional breakage rather
  than permanent failure, but it is a standing dependency risk a public repo
  should state.
- **Matching without an identifier will be wrong sometimes.** The design
  answer is that a wrong match costs a rejection rather than a corrupted
  playlist, because nothing applies without confirmation and nothing is ever
  deleted.
- **A wrong fill is the costlier error.** A wrong *pairing* misorders a track
  that was already there; a wrong *fill* puts a track in the playlist that
  does not belong. Search widens the candidate pool to the whole catalogue,
  where a same-titled cover or karaoke version is far likelier than in the
  playlist the user themselves assembled. Hence the separate confirm-all,
  the multiple candidates per row, and the recorded addition list that makes
  undo exact.

---

## 14. Open questions

- **Importing YouTube-only tracks into Spotify.** §10 rules it out of phase 2,
  and I think that is right for now — Spotify is the canonical list, and
  adding to it from a search guess is the one write whose blast radius is the
  source of truth itself. It is also the natural next thing to want once the
  reverse direction is working and trusted. Worth deciding deliberately rather
  than by omission; the sync report will make the size of the gap visible, so
  the decision can wait until there is a real number attached to it.
**Settled 2026-09-20:** Python is available and agreed (3.13.14). The Data
API stays out (D21). YouTube-only sorting is in (D20). The one Google sign-in
question dissolved with the Data API.

- **Does a playlist's `sortOrder` need setting, or only reading?** If YouTube
  refuses a manual reorder while a playlist is on `NEWEST_FIRST`, we either
  change it — a visible change to the user's own view settings, which wants
  consent — or refuse and explain. Cheap to answer in 2a against a real
  playlist; expensive to guess at now.
- **Does playlist *editing* work under browser auth?** It should — browser
  auth is the fuller of the two methods, and the docs' only carve-out runs the
  other way (uploads work under browser auth but not OAuth). "Should" is not
  "does", and it is the first thing 2a proves.

### Carried forward from the write-seam branch (2026-09-20)

Plan 1 built the writer seam. Its final review found the seam is structurally
clean — `src/plan/` imports no service — but **not yet sufficient for a second
writer**, in one specific way. Recorded here rather than left in a scratch
ledger, because it is a precondition for 2a rather than a defect in what
shipped.

- **A writer cannot resolve `op.key` to a service item id.** `executeReorder`
  keys its plan on `track.originalIndex`, so a YouTube writer receives
  `{ key: 7, beforeKey: 3 }` and has no way to reach the `setVideoId` it must
  actually send.

  **Resolved 2026-09-22 against real data, not guessed.** The two objections
  that caused the deferral both fail on measurement: `setVideoId` is present on
  379 of 379 rows and holds 379 distinct values, so it has the uniqueness
  `diff.js` requires, and there are no nulls to collide with the `beforeKey`
  sentinel. So `executeReorder` gains a `keyOf` option defaulting to
  `(track) => track.originalIndex`; the YouTube caller passes
  `(track) => track.itemId`. The adapter rejects a null `setVideoId` at
  normalization rather than letting it reach the planner.
- **`clone.test.js` asserts Spotify's 100-item batch boundaries** through the
  now service-neutral seam. The neutral contract requires no particular batch
  size, so when a second writer lands this should become "onProgress is
  forwarded, and the final call is `(total, total)`".
- **`csv/detectColumns.js` and `csv/match.js` still hardcode Spotify URI
  patterns** (§4 named this). The mirror path does not need them, so it stays
  out of scope — but CSV-driven ordering of a YouTube playlist would.
