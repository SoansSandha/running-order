# Match review — Design

**Date:** 2026-10-05
**Status:** Draft for review
**Scope:** Plan A of deliverable 2b. Builds on
[2026-09-18-youtube-mirror-design.md](2026-09-18-youtube-mirror-design.md)
§7 (matching), §8 (the match book) and §9 (the confirmation surface), whose
decisions still hold except where D23–D26 below change them.

---

## 1. What this is

Inside the app, pick one Spotify playlist and one YouTube playlist, see which
track is which, and settle each pair. Decisions are stored, so the next review
of the same songs only asks about what is new. Plan C acts on them.

**Read-only.** Plan A writes nothing to Spotify or YouTube.

**Done when:** opening the real Punjabi Songs pair shows 244 strong, 63 likely,
111 only on Spotify and 78 only on YouTube; confirming, rejecting and pairing
by hand all work; and after the app is reloaded those decisions are still
settled.

---

## 2. Decisions

Continuing the numbering in the mirror design, where these are also recorded.

| # | Decision | Rejected | Why |
|---|---|---|---|
| D23 | **Fill runs both ways.** A confirmed pick can add a song to the Spotify playlist as well as to YouTube. Replaces D19's one-direction rule | YouTube-only fill (D19) | A song only on YouTube has no position in Spotify's order, so linking it does nothing; adding it does. D19 refused Spotify writes *from a guess*, and a pick the user confirms is not one. Applies in Plans B and C |
| D24 | **Search runs on demand, per row**, from the pair picker: "Search YouTube Music" for a Spotify song, "Search Spotify" for a YouTube song | Searching every unmatched song automatically (§9's fill rows) | The user reaches for search when the other playlist has no candidate. On demand, it costs one search per song the user actually asks about, not one per unmatched song every review. Plan B |
| D25 | **Pairing by hand.** An unmatched Spotify song can be paired with any unmatched YouTube song | Listing unmatched songs only | Measured: about 20–25 of the 78 unmatched YouTube tracks are songs on the Spotify playlist that the matcher cannot pair (label-channel uploads, which root cause 8 deliberately leaves out; videos more than 30s off). Left unpaired, Plan B would search for them as missing and Plan C would add a second copy |
| D26 | **The review starts from the Spotify playlist**, via a "Match to YouTube" button on its Sort screen. The YouTube playlist is chosen each time | A Sync mode on the playlists board; remembering each pairing | Follows the sync order: sort Spotify, then make YouTube follow it. With four YouTube playlists, choosing is one click; remembering it can come when it is missed |

---

## 3. The screen

A Spotify playlist's Sort screen gets a **Match to YouTube** button. It opens
the review screen, whose header holds a dropdown of the user's YouTube
playlists. Choosing one loads it, scores every pair (about 0.35s for the real
playlists, shown as a busy meter), and fills the board.

```
PUNJABI SONGS  ↔  [ punjabi songs ▾ ]      244 strong · 63 likely · 0 settled
                                            111 only on Spotify · 78 only on YouTube
                                            4 unavailable on YouTube

LIKELY — check each one
  Maar Sutya         ▶   Maar Sutiya        ▶   −2s   titles differ slightly   [Confirm] [Reject]
  Amrinder Gill…         Amrinder Gill

STRONG                                                           [Confirm all 244]
  SWITCHIN' LANES    ▶   SWITCHIN' LANES    ▶   +0s                       [Confirm] [Reject]

ONLY ON SPOTIFY (111)
  Akh Lag Gayi       ▶   [ Pair with… ▾ ]

ONLY ON YOUTUBE (78)
  No Need (Full Video) Karan Aujla | Deep Jandu | …   ▶

SETTLED (0)  ▸   (collapsed)
```

- **Group order:** Likely first, because it needs the user. Then Strong, with
  **Confirm all** acting on that group only (mirror design §9). Then the two
  unmatched lists, counted. Settled last, collapsed by default.
- **A pair row** shows both titles and artists, a ▶ link on each side
  (`open.spotify.com/track/{id}`, `music.youtube.com/watch?v={videoId}`; a
  local file has no Spotify link), the signed duration difference, and the
  matcher's reason.
- **Confirm** settles the pair.
- **Reject** dissolves the pair and remembers that. The Spotify song is then
  re-paired with its next-best YouTube candidate if it has one, and otherwise
  moves to "Only on Spotify".
- **Pair with…** on an unmatched Spotify row is a dropdown of the unmatched
  YouTube songs, closest title first. A pick settles the pair. Plan B adds the
  two search options to this same picker (D24).
- **Settled rows carry Undo**, which forgets the decision. A wrong Reject is
  repaired with Pair with…, so there is no separate list of rejections.
- The board uses the existing vocabulary: amber pending, green settled, red
  for errors.

---

## 4. The match book

One record per decided pair:

```js
{ spotifyKey, youtubeVideoId, verdict: 'same' | 'different', decidedAt }
```

- **`spotifyKey`** is the Spotify track id, or for a local file — which has
  none — its `spotify:local:…` URI.
- **One decision per pair.** Deciding again replaces the earlier one; Undo
  deletes it. Confirm and Pair with… store `same`; Reject stores `different`.
- **Not tied to a playlist.** "These two are the same song" holds wherever
  they appear, so a song in two playlists is decided once.
- **Stored in `localStorage`** under `playlist-sorter:match-book`, with the
  same prefix and try/catch discipline as the undo snapshots
  (`src/plan/undo.js`), and the storage injected the same way for tests. A
  blocked store leaves the screen working for the session. A stored value
  that does not parse starts an empty book rather than failing.
- **Export and import as a JSON file** (mirror design §8) is deferred until
  the book holds work worth backing up.

---

## 5. Matching changes

- **Scoring and settling are split.** Scoring every pair is the slow half and
  runs once per review. Applying decisions and claiming pairs is cheap and
  reruns after every click. `pairTracks` keeps its signature and behaviour,
  built from the two halves, so its existing tests stand.
- **Decisions are looked up by `spotifyKey`**, not by `id`, so a local file's
  decision is found. Today `pairTracks` passes `left?.id`, which is `null` for
  a local file.
- **The user's decision beats the matcher.** `same` settles a pair even where
  `scorePair` proposes nothing, which is what makes Pair with… work.
  `different` removes a pair outright.

---

## 6. When things go wrong

| Situation | What the review screen shows |
|---|---|
| Proxy not running | The existing `ProxyUnavailableError` notice. The Spotify songs stay loaded, and choosing again retries |
| YouTube session expired | The `YouTubeSessionExpiredError` message, with its refresh steps |
| A YouTube playlist fails to load | A red notice; the dropdown stays usable |
| Storage blocked | An amber notice: decisions will not be remembered after the tab closes |
| YouTube counts songs it will not return | The header line "N unavailable on YouTube" (counted minus readable), so none vanish unexplained |

---

## 7. Testing

- **Unit, test-first:**
  - **Match book:** record, replace and undo; the local-file key; blocked
    storage; a corrupted stored value.
  - **The split:** reproduces `pairTracks`; a Reject re-pairs with the
    next-best candidate; a Pair with… `same` wins over a matcher `null`;
    decisions resolve for local files.
  - **Pair with… ordering:** closest title first.
- **Real libraries:** before any screen work, the split must reproduce the
  current counts exactly — 244 / 63 / 111 / 78 — on the exported playlists.
- **The screen:** this repo has no component-test infrastructure, so a manual
  walkthrough is the gate, and Plan A is not done until it passes. Script:
  open Punjabi Songs → Match to YouTube → choose punjabi songs → check the
  counts → Confirm one, Reject one, Pair one with…, Undo one → Confirm all
  strong → reload the app → the decisions are still settled. The owner runs
  it; skipping exactly this gate let two Criticals through in 2a.

---

## 8. Not in Plan A

| Item | Where it goes |
|---|---|
| "Search YouTube Music" and "Search Spotify" in the picker | Plan B (D24) |
| Adding picked songs to either playlist; reordering YouTube | Plan C (D23) |
| Remembering which YouTube playlist goes with a Spotify playlist | When it is missed (D26) |
| Exporting and importing the match book | Before the book holds real work |
