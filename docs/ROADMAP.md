# Roadmap

What is planned but not built. Recorded so the shape of the work is clear and
so nothing here is mistaken for something that exists.

Current state is in [STATUS.md](STATUS.md).

> **Phases 2 and 3 below are superseded** by
> [2026-09-18-youtube-mirror-design.md](2026-09-18-youtube-mirror-design.md).
>
> They are kept because the questions they raise are the ones the spike went
> on to answer, and the answers are only legible beside the questions. In
> short: YouTube Music does not expose the metadata that half the sort
> strategies need, so it does not become a second *sortable* source. Spotify
> stays canonical and a YouTube playlist is made to match it — the two phases
> below collapse into one. The reasoning is in the spec.

---

## Phase 2 — YouTube Music as a second source *(superseded)*

Sort a YouTube Music playlist with the same strategies that already work on
Spotify.

Most of this product is already service-agnostic and was built that way on
purpose. `sort/`, `plan/` and `csv/` operate on a normalized `Track`, not on
anything Spotify-shaped, and they never import from `api/`. Adding a service
means adding a second adapter, not a second application.

| Layer | Reusable as-is? |
|---|---|
| `sort/` — nine strategies | Yes. Plain arrays of Track |
| `plan/diff.js` — the reorder algorithm | Yes, if the service supports positional moves |
| `plan/undo.js`, `csv/` | Yes |
| `model/track.js` | Needs a second normalizer to the same shape |
| `api/` | Needs a YouTube Music client |
| `auth/` | Needs Google OAuth alongside Spotify PKCE |
| `ui/` | Needs a source indicator; the board itself is unchanged |

### Known unknowns, to settle before building

- **There is no official YouTube Music API.** The Data API v3 covers YouTube
  playlists, which is adjacent but not the same catalogue. Whether the
  product targets YouTube playlists, YouTube Music via an unofficial client,
  or both, is the first decision and it governs everything after it.
- **Does it support positional moves?** The whole minimal-move design rests on
  a "move this item to this position" operation. Without one, reordering means
  rewriting the playlist, which is exactly the trade-off decision D4 rejected
  for Spotify. If it cannot move, that limitation must be stated in the UI
  rather than hidden.
- **Quota.** The Data API charges quota per call and is far tighter than
  Spotify's rate limit. A 400-track reorder may not fit in a day's allowance,
  which would change the design rather than just the speed.

None of this is knowable from here. It is API research, and it comes first.

---

## Phase 3 — Reconciling one playlist across both services *(superseded)*

Connect both services, pick the same playlist on each, and see what each one
is missing. Then sync in either direction.

### Why this is harder than it looks

Within one service, a match is **certain**: two tracks with the same URI are
the same track, and the CSV matcher can act on that without asking. Across
services there is **no shared identifier**. The same song has a different id
on each side, and often a different title, a different artist string, a
different album, and a different duration.

ISRC is the closest thing to a shared key and is the obvious first tier, but
coverage is incomplete and inconsistent — the same recording can carry
different ISRCs across distributors, and plenty of catalogue carries none.

So every cross-service match is a **proposal**, not a fact. That is the
governing constraint, and it is recorded as a product principle: *a guess is
never applied as a fact*.

### The confirmation surface

This is the real design work of the phase.

- Each proposed pair shows both sides together: title, artist, album, duration
  on each service.
- Each side carries a link that plays it, so a doubtful pair can be checked in
  seconds rather than guessed at.
- Pairs are confirmed **one at a time**, and confirming is the only thing that
  authorizes a write.
- A **confirm-all** exists for when the list is obviously right, because
  clicking through forty certain matches is its own kind of failure. It should
  make the risk it is accepting visible, not bury it.
- Anything unmatched on either side is listed, counted, and never quietly
  dropped — the same discipline the CSV reconciliation report already follows.

Much of the matching machinery already exists in `csv/match.js`: tiered
matching, conservative title folding that keeps `(Live)` and `(Remix)` while
dropping `(feat. X)`, Dice-coefficient fuzzy scoring, and greedy pairing from
a pool so duplicates resolve honestly. Cross-service matching is a harder
instance of the same problem, and should extend that module rather than fork
it.

### Direction of sync

Adding a track to the other side is a **membership change**, which is a
category the product has so far refused — decision D3 confined the CSV to
reordering precisely because adding requires a search layer and a
disambiguation UI. Phase 3 is where that gets built, and it needs its own
guarantees: what happens to a track that exists on neither side after a
failed search, whether a sync is one-way or two-way per run, and what the
undo story is when the write lands on a different service from the snapshot.

---

## Smaller things, unscheduled

| | |
|---|---|
| Resuming an interrupted run | The undo snapshot is written and restorable; "a tab died mid-run" detection on next load is not wired |
| Dry-run detail | Reports a count, does not list the operations |
| Character-cell flapping on titles | Today only the position numerals flap. The largest unused piece of the board's own vocabulary |
| Grain on the board body | "Enamelled" is currently delivered as flat charcoal |
