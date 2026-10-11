# No match — Design

**Date:** 2026-10-11
**Status:** Draft for review
**Scope:** An addition to the match tray
([2026-10-10-match-tray-design.md](2026-10-10-match-tray-design.md)). It
builds on [2026-10-05-match-review-design.md](2026-10-05-match-review-design.md)
and [2026-10-08-catalogue-search-design.md](2026-10-08-catalogue-search-design.md).
Their decisions still hold except where D37–D40 below change them.

---

## 1. What this is

The owner can mark an unmatched song as **not on the other service**: a
Spotify song that YouTube Music does not have, or a YouTube song that Spotify
does not have.

- **The mark states a fact** about the other catalogue. It is not a
  preference about mirroring.
- **A marked song:**
  - leaves "Only on Spotify" / "Only on YouTube";
  - is never searched for again;
  - is never offered as a candidate in the other side's trays.
- **The mark is undone** from the song's own row, for when the song appears
  on the other service later.

**Why:** after a sweep, the unmatched groups hold two kinds of song. Some
still need a match. Others the owner has checked and knows have none. Today
nothing separates them, so the second kind is searched again by every sweep
and keeps counting as work to do.

**Read-only.** A mark is a decision in the match book. Nothing is written to
Spotify or YouTube.

**Testing** uses the playlist "test punjabi songs" on the owner's test
profiles in Spotify and YouTube Music.

**Done when:**
- on "test punjabi songs", an unmatched song can be marked from its tray, and
  it moves to "Not on the other service";
- a reload keeps the mark;
- "Search all unmatched" no longer searches a marked song;
- Undo returns the song to its unmatched group;
- the layout check (match tray design §10) finds no column overlap at any
  width.

---

## 2. Decisions

Continuing the numbering in the earlier designs.

| # | Decision | Rejected | Why |
|---|---|---|---|
| D37 | **A mark is a one-sided decision in the match book.** A Spotify song's is `{ spotifyKey, youtubeVideoId: null, verdict: 'none', decidedAt }`; a YouTube song's is `{ spotifyKey: null, youtubeVideoId, verdict: 'none', decidedAt }` | A separate store under its own key; recording `different` against every candidate | The owner's choice. One book means one save and one Undo path. Recording `different` against every candidate breaks the first time a search turns up a new one |
| D38 | **The playlists win.** A mark applies only to a song left unmatched after the two playlists are paired. If the song later pairs from the playlists, the pair shows and the mark is ignored | A mark that blocks pairing | A mark states that the other service does not have the song. A pair from the two playlists proves it does |
| D39 | **Marking happens in the tray only.** It is offered in the tray of an unmatched song and in the tray of a proposed find, but not for a pair from the two playlists or for a settled pair | A button on every unmatched row | The owner's choice: mark only after looking and listening. A find's tray offers it because one mark replaces rejecting each wrong find in turn |
| D40 | **Marked songs have their own collapsed group,** "Not on the other service", after Settled. Each row's one lever is **Undo**, at every width. The rows take the green settled seat | Hiding marked songs; a header tally for them | A mark is a decision the owner has made, so it reads as settled (the Quarantined Colour Rule) and stays where it can be undone. The group heading carries the count |

---

## 3. In the match book

- **The loader** accepts a `none` entry only when exactly one of `spotifyKey`
  and `youtubeVideoId` is a string and the other is `null`.
  - A `none` entry with both sides, or with neither, is dropped, as any
    malformed entry is today.
  - `same` and `different` still need both sides.
- **Recording and forgetting a mark** use the existing `recordDecision` and
  `forgetDecision`, with the empty side passed as `null`.
  - Recording a mark replaces an earlier mark for the same song.
  - Forgetting it removes it.
- **`verdictLookup` ignores `none` entries.** Pairing asks it only about
  pairs.
- **The storage key** (`playlist-sorter:match-book`) and the shapes of `same`
  and `different` decisions are unchanged.

---

## 4. Settling

- **A new pure step, `setAsideMarked(settled, book)`,** runs between
  `settlePairs` and `settleFound`.
  - It moves every song in `unmatchedSpotify` with a Spotify mark, and every
    song in `unmatchedYoutube` with a YouTube mark, into `markedSpotify` and
    `markedYoutube`.
  - A song listed twice is set aside in both copies, since a mark is filed
    under the song's key.
  - Songs in pairs are not touched (D38).
- **`settleFound` then runs on what is left,** so a marked song gets no find
  proposal, even when an earlier sweep found candidates for it.
- **The review's result** carries `markedSpotify` and `markedYoutube`
  alongside the existing fields.
- **Unchanged:** `settlePairs`, `settleFound`, `findOnYouTube` and
  `findOnSpotify`.
- **What follows from the unmatched lists:**
  - the sweep searches only songs in them;
  - the tray's leftovers come from them;
  - the header's Only Spotify and Only YouTube counts are their lengths.

  So a marked song drops out of all three without further change.

---

## 5. On the screen

**In the tray (D39):**
- A quiet lever, **Not on YouTube Music** or **Not on Spotify** (the
  service the tray searches), sits at the top of the tray's right column,
  above the search box, so marking needs no scroll past the candidates.
- It is shown in:
  - the tray of an unmatched song;
  - the tray of a proposed find (a Likely or Strong pair marked "Not in your …
    playlist"). There it marks the pair's playlist-side song.
- It is not shown for a pair from the two playlists, or for a settled pair.
- Pressing it records the mark and closes the tray.
- Like **Pair**, it waits while a sweep runs (match tray §3).

**On the board (D40):**
- A collapsed group, **Not on the other service (N)**, follows Settled. It
  is built like Settled.
- Each row shows:
  - the song in its own service's column;
  - "Not on YouTube Music" or "Not on Spotify" in the other column;
  - "You marked this" in the Why column;
  - **Undo** in the action column.
- The length cell is empty.
- The rows take the settled green seat (`data-written`).
- **Undo** is not inside `row-decide`, so a phone keeps it on the row. It is
  the row's one lever (match tray D35), and these rows have no tray.
- **Undo** waits while a sweep runs.

---

## 6. The pieces

| Piece | What it does | Tested by |
|---|---|---|
| `loadMatchBook` in `src/match/matchBook.js` | §3's loader rule | Unit tests: both one-sided shapes kept; both-sided and empty `none` dropped |
| `verdictLookup` in `src/match/matchBook.js` | Ignores `none` (§3) | Unit test |
| `setAsideMarked(settled, book)` in `src/match/settleFound.js` | §4's step | Unit tests: a marked song set aside on each side; an unmarked song left; a song listed twice; a marked song that pairs from the playlists left paired; a marked song with sweep candidates gets no find once `settleFound` runs |
| `markNoMatch(song)` and `unmark(song)` in `src/ui/useMatchReview.js` | One save each. The song's own `source` names the side its key is filed under. The existing 400ms and missing-key guards (M-3) apply | The walkthrough |
| `MatchTray` | §5's lever, through an optional `onNoMatch` prop; the lever is shown only when it is given | The layout check and the walkthrough |
| The review screen | Passes `onNoMatch` per D39; renders §5's group | The layout check and the walkthrough |
| `scripts/check-columns.js` | Seeds one mark beside the settled seed, and opens the new group before measuring | Running it: it must report `{}` |

---

## 7. Testing

- **Unit, test-first:** every row of §6's table that names unit tests.
- **The layout check** (`scripts/check-columns.js`) opens the new group at all
  six widths and must report `{}`.
- **The walkthrough,** on "test punjabi songs" (test profiles), covers:
  - marking an Only on Spotify song, and an Only on YouTube song. Each moves to
    the new group, and its group's count drops by one;
  - reloading: both marks remain;
  - "Search all unmatched": its total no longer counts the marked songs;
  - a Spotify song's tray no longer lists a YouTube song marked not on
    Spotify among its leftovers;
  - marking from a proposed find's tray: the proposal goes, and the song is in
    the new group;
  - Undo on a marked row: the song returns to its unmatched group;
  - during a sweep, the tray's mark lever and the group's Undo are greyed out;
  - at 680px or less, a marked row shows its two track columns and Undo.

---

## 8. When things go wrong

| Situation | What happens |
|---|---|
| The browser blocks storage | The existing notice; marks last while the screen is open, like every decision |
| A song with no key (M-3) | The mark is ignored, as a decision on it is today |
| A marked song is later added to the other playlist and pairs | The pair shows; the mark stays in the book, ignored (D38). If the pair goes, the mark applies again |
| A sweep is running | The mark lever and Undo are disabled, with the existing note |

---

## 9. Not in this plan

| Item | Where it goes |
|---|---|
| Marking from the row, or many songs at once | When marking one by one is missed (D39) |
| A header tally for marked songs | Not planned (D40) |
| Plan C reading marks | Not needed: a marked song has no twin to add |
