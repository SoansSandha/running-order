# Match tray — Design

**Date:** 2026-10-10
**Status:** Draft for review
**Scope:** The third plan of deliverable 2b. Builds on
[2026-10-05-match-review-design.md](2026-10-05-match-review-design.md) (Plan A)
and [2026-10-08-catalogue-search-design.md](2026-10-08-catalogue-search-design.md)
(Plan B). Their decisions still hold except where D31–D36 below change them.

---

## 1. What this is

Every row on the match review opens a **tray** directly beneath it. The tray is
where one song gets matched. It holds:

- **players** for both sides;
- **a search box**, pre-filled with what the sweep searched, that the owner can
  edit and run again;
- **a field for pasting** a Spotify or YouTube Music link;
- **candidates**: search results first, then the other playlist's leftovers.
  Each carries the matcher's verdict in words, plus **▶ Listen**, **↗ Open** and
  **Pair**.

It replaces the Pair with… dropdown.

**Why:** the dropdown is the browser's own `<select>`, which breaks the Board
Furniture Rule (DESIGN.md). It cannot carry a play button, a search box or a
link field, and the owner could not hear a candidate before pairing it.

**Read-only.** Nothing is written to Spotify or YouTube. Searching, looking up
a link and playing a preview are reads.

**Testing** uses the playlist "test punjabi songs" on the owner's test profiles
in Spotify and YouTube Music.

**Done when:**
- on "test punjabi songs", every unmatched song can be settled from its tray,
  by the owner's own search or by a pasted link;
- every candidate can be heard in the tray and opened in its own service;
- a settled row shows what the matcher thinks of its pair;
- the layout check (§10) finds no column overlap at any width.

---

## 2. Decisions

Continuing the numbering in the earlier designs.

| # | Decision | Rejected | Why |
|---|---|---|---|
| D31 | **A tray under the row.** Unmatched rows get **Find a match**; Likely, Strong and Settled rows get **Listen**. One tray is open at a time. Replaces D25's dropdown picker | A match desk docked beside the board; a focus view of one song at a time | The owner's choice, made from mockups: matching happens where the song sits |
| D32 | **Listening happens in the app**, through Spotify's and YouTube's own embedded players. **↗ Open** opens the song in its own service | Opening a new tab only | The owner's choice. Hearing both sides side by side is what makes a pick trustworthy |
| D33 | **The owner's own search stays in the tray.** Its results are never proposed on the board; only **Pair** settles one | Feeding manual results into settleFound as proposals | A manual search is the owner looking for one song. Proposing its results would turn a look into a claim |
| D34 | **A pasted link pairs at once**, as the owner's word, like a pick from the tray. **Every settled row shows the matcher's verdict on its pair** | Showing the linked track first and asking for a second click | The owner asked to "just provide the link". Showing the verdict on the settled row makes a wrong paste or pick visible, and Undo repairs it |
| D35 | **On a phone (≤680px) the board keeps the two track columns and one tray button.** The length column hides; Confirm, Reject and Undo move into the tray | The current phone grid | Measured on 2026-10-10: the current grid leaves each track column about 37px of text, so titles shrink to two letters |
| D36 | **Every list in the tray is one grid**, its rows laid on it as subgrid, with the action column sized to its widest buttons. A layout check guards the board against overlap | Fixed-width action columns, as on the board today | The first tray mockup's fixed 190px column was narrower than **■ Playing · ↗ Open · Pair**, and the buttons ran over the length column |

---

## 3. The tray

- **Opening it.** A row's **Find a match** (unmatched) or **Listen** (Likely,
  Strong, Settled) opens its tray directly beneath it, pushing the rows below
  down. Opening another row's tray closes the first; **Close** on the row or in
  the tray closes it.
- **Players.** The tray's left column holds one Spotify player and one YouTube
  player (§6). On opening:
  - an unmatched song loads into its own side's player;
  - a pair loads both songs.
- **Right column, top to bottom:**
  1. **The search box and its button**, labelled **Search YouTube Music** or
     **Search Spotify** for the other service (§4).
  2. **The link field**, with **Pair** (§5).
  3. **Search results:** what the sweep found for this song, or what the
     owner's own search found, which replaces them.
  4. **The other playlist's leftovers**, under "In your YouTube playlist" or "In
     your Spotify playlist", closest title first, as Pair with… listed them.
- **Each candidate** shows its title, artists and length, the matcher's verdict
  in words (§7), and three buttons:
  - **▶ Listen** loads it into its side's player. While it plays, the button
    reads **■ Playing**.
  - **↗ Open** opens it in Spotify or YouTube Music, in a new tab.
  - **Pair** records `same`, with a snapshot when the candidate is a find (D29),
    exactly as a Pair with… pick did.
- **A pair's tray** shows "The matcher says: …" for the pair and **↗ Open** for
  each side.
  - **A proposal (Likely, Strong)** adds "Not this one? Pick another": the same
    search, link field and candidates for its playlist-side song. Picking
    another replaces the proposal. Confirm and Reject stay on the row.
  - **A settled pair's tray** only listens. To pick another, Undo it, then use
    **Find a match**.
- **The row's own Play link** becomes **↗ Open**, on every row.
- **During a sweep** (catalogue search §8), listening and the owner's own search
  still work. **Pair**, **Confirm**, **Reject** and **Undo** wait until the sweep
  ends or is stopped, in the tray as on the board.

---

## 4. The owner's own search

- **The box starts with the sweep's query** for this song, so the owner edits
  rather than retypes.
  - **A Spotify song:** `"<title> <primary artist>"`, e.g.
    `Akh Lag Gayi Param Mundi`.
  - **A YouTube song:** the essential title with the primary artist, e.g.
    `sheesha Karan Aujla`.
- **What a search runs:**

| The song is on | The box searches | Results |
|---|---|---|
| Spotify | YouTube Music, songs then videos | Up to 10 songs and 5 videos, merged, without repeats |
| YouTube | Spotify, the text as typed (no field syntax) | Up to 10 (Spotify's maximum) |

- **Ordering:**
  - Results the matcher accepts (strong, then likely, nearest length first) come
    first.
  - The rest follow in search order.
  - A result already in the other playlist is still listed, because the owner
    may want it, but it is marked "Already in your … playlist".
- **Lifetime:** results live in the tray until it closes (D33). Searching again
  replaces them.
- **While a search runs,** its button reads **Searching…** and is disabled.
- **A failed search** shows one line under the box ("Could not search YouTube
  Music: the proxy is not running.") and leaves the earlier results in place.

---

## 5. Pasting a link

- **Accepted forms:**
  - **Spotify:** `https://open.spotify.com/track/<id>`, also with an
    `/intl-xx/` segment or a `?si=…` query, and `spotify:track:<id>`. An id is
    22 base-62 characters.
  - **YouTube:** `https://music.youtube.com/watch?v=<id>`,
    `https://www.youtube.com/watch?v=<id>`, `https://youtu.be/<id>`, with any
    other query parameters. An id is 11 characters of `A–Z a–z 0–9 - _`.
- **Parsing** is one pure function, `parseTrackLink(text)`. It returns
  `{ service: 'spotify' | 'youtube', id }`, or `null` for anything else (an
  album or playlist link, a search page, plain text).
- **The wrong service** gets one line under the field: "That's a Spotify link.
  This song needs a YouTube Music one." The other way round reads the same.
- **Anything else** gets: "That isn't a link to one song on YouTube Music." (or
  Spotify).
- **Looking it up:**
  - **Spotify:** `GET /v1/tracks/{id}`, still available to a development-mode
    app; only the batch endpoint was removed in February 2026. It is normalized
    as a playlist row is.
  - **YouTube:** a new read-only proxy route, `GET /track/{videoId}`. It
    returns `{ track }`: the first track of `get_watch_playlist(videoId,
    limit=1)`, the same fields a search result has, passed through.
    - Measured on 2026-10-08 and 2026-10-10: unauthenticated, it returns the
      title, artist list, album, `length` (as text, e.g. `2:16`) and
      `videoType` for both an album track and an official video.
    - The app reads `length` itself.
    - YouTube answers an id it does not have with a server error, so the
      route answers `{ track: null }` for that error, and for a queue that
      starts with another video.
- **Pair** looks the link up, then records `same` at once, with a snapshot when
  the track is in neither playlist (D29, D34). The tray closes, and the settled
  row shows the matcher's verdict.
- **A link that does not resolve** (deleted, private, region-blocked) shows "That
  track could not be found." and pairs nothing.

---

## 6. Listening and opening

**Players:**

| Side | Player | Size | Plays |
|---|---|---|---|
| Spotify | `https://open.spotify.com/embed/track/<id>` in an iframe | Full width × 80px | The full track when the browser is signed in to Spotify, otherwise a 30-second preview. Its own play button may need a press |
| YouTube | `https://www.youtube-nocookie.com/embed/<id>?autoplay=1` in an iframe with `allow="autoplay; encrypted-media"` | Full width, at least 200×200px (YouTube's minimum) | The full video, starting when **▶ Listen** is clicked. If the browser still refuses autoplay, YouTube's own play button starts it |

- **A video whose uploader blocks embedding** shows YouTube's own message inside
  the player; **↗ Open** is the way to hear it.
- **A Spotify local file** cannot be embedded or opened. Its player reads "A
  local file can't play here."
- **The players are framed as seated wells** (DESIGN.md): the iframe sits inside
  a 1px hard rule on the deep ground. They are the services' own controls; the
  board does not restyle them.
- **↗ Open** goes to `https://open.spotify.com/track/<id>` or
  `https://music.youtube.com/watch?v=<id>`, in a new tab.
- **Only one tray is open**, so at most one Spotify and one YouTube player exist
  at a time.

---

## 7. The matcher's verdict, in words

- **An accepted pair** shows `scorePair`'s own reason, prefixed by its tier:
  "strong: title and artist match exactly", "likely: the durations differ by 3s".
- **A refused pair** shows "no match:", then the facts that differ, in this
  order:
  - "lengths differ by 67s", when the lengths are more than 2s apart, or "no
    length to compare" when a side has none. It names no side as longer, so
    it reads the same from either side's tray;
  - "different title", when the titles differ even once credits and
    decoration are set aside;
  - "no artist in common", when no artist is shared.

  For example: "no match: lengths differ by 67s, different title, no artist
  in common". When none of these differs, it reads "no match: a different
  version".
- **A settled row's reason** is "You confirmed this · the matcher says:
  <verdict>", whether the pair was confirmed, picked or pasted as a link. A
  pair the matcher would have refused is visible at a glance.

---

## 8. The phone layout (≤680px)

- **The board** keeps Spotify and YouTube as its two track columns and one
  action column: a single button, **Find a match** or **Listen**. The length and
  Why columns hide.
- **Confirm, Reject and Undo** move into the tray on a phone (D35).
- **The tray stacks:** the players on top, the YouTube player full width at
  200px tall, then the search, the link field and the candidates.
- **Each candidate** folds its verdict under its title. Its three buttons sit on
  one line beneath them.

---

## 9. The pieces

| Piece | What it does | Tested by |
|---|---|---|
| `parseTrackLink(text)` in `src/match/links.js` | §5's link reading | Unit tests: every accepted form, both services, and the rejects |
| Proxy `GET /track/{videoId}` | §5's YouTube lookup, read-only, as thin as `/search` | pytest: passes the track through, `{ track: null }` for a missing video or another video's queue, a clean 502 otherwise, never leaks exception text |
| `youtube.track(videoId)`; reading a `length` like `2:16` in the YouTube normalizer | The client call for that route, and the length a watch-playlist track gives only as text | Unit tests |
| `getTrack(client, id)` in `src/services/spotify/search.js` | §5's Spotify lookup | Unit test |
| `explainPair(spotify, youtube)` in `src/match/scorePair.js` | §7's words for any pair, accepted or refused | Unit tests |
| `rankResults(song, results, { side, inOtherPlaylist })` in `src/match/findTwin.js` | §4's ordering, with each result's verdict and its "already in your playlist" mark | Unit tests on real pairs |
| `searchCatalogue` and `lookupLink` in `src/services/trackLookups.js` | §4's own search and §5's link lookup, with its one-line errors | Unit tests with fake clients |
| `openHref(track)` in `src/ui/format.js` | Where **↗ Open** goes | Unit tests |
| `MatchTray` in `src/ui/screens/MatchTray.jsx` | The tray (§3) | The layout check and the walkthrough |
| The review screen | Opens one tray at a time; a settled row's reason (§7) is built from `explainPair` | The layout check and the walkthrough |
| `src/ui/review.css` | The tray's styles. Every list in the tray is one grid with subgrid rows (D36). The review board's own grid stays in `board.css`, declared once per breakpoint | The layout check |

- **Which tray is open** is the review screen's own state.
- **The tray runs its search and its link lookup itself,** through
  `trackLookups.js`, and hands the chosen track back. The review records the
  decision with the existing `decide`.
- **The hook only adds** the playlists' id sets, so the tray can mark a result
  already in the other playlist.
- **Unchanged:** `settlePairs`, `settleFound`, `findOnYouTube` and
  `findOnSpotify`.

---

## 10. Testing

- **Unit, test-first:** every row of §9's table that names unit tests.
- **The layout check** is a committed `playwright-cli` script,
  `scripts/check-columns.js`. It opens every screen in demo mode at 1440, 1280,
  1024, 860, 680 and 390px, with the review board fed synthetic long titles and
  artists through a mocked proxy. It reports any element that extends past its
  column. It must report nothing.
  - It is the check that found the overlap fixed in `ca0969f`.
  - Run against this design's tray, it found two action columns too narrow
    for their buttons:
    - the review row's Listen, Confirm and Reject need 37ch;
    - the Playlists board's "Clone only" chip needs 15ch. That one spills on
      today's board too.
  - It uses no private data, and adds no dependency: `playwright-cli` is
    already installed on the machine.
- **The walkthrough,** on "test punjabi songs" (test profiles), is the gate for
  the tray. It covers:
  - finding a match by the owner's own words;
  - pairing by a Spotify link and by a YouTube Music link;
  - a wrong-service link;
  - listening on both sides;
  - **↗ Open** on both sides;
  - a refused pair's verdict on its settled row;
  - the phone layout.
- It also covers Plan A's and Plan B's walkthroughs, which have not yet been run
  on the test profiles.

---

## 11. When things go wrong

| Situation | What the tray shows |
|---|---|
| The proxy is not running | The search or link lookup's one-line error. Listening on the Spotify side still works |
| Spotify rate limits or the session lapses | The client's message, on the line under the box |
| A video blocks embedding | YouTube's own message in the player; **↗ Open** still works |
| A link that is not one song, or is for the wrong service | §5's one-line messages; nothing is paired |
| A link that does not resolve | "That track could not be found." Nothing is paired |
| A sweep is running | Pair, Confirm, Reject and Undo are disabled, with the existing note |

---

## 12. Not in this plan

| Item | Where it goes |
|---|---|
| Adding paired songs to either playlist | Plan C (D23) |
| Remembering the owner's own search results across trays or reloads | When it is missed (D33) |
| Changing the sweep's queries | Not planned: the owner's search edits one song's query |
| A queue or "next unmatched" stepping | Not planned (D31 chose the tray over a focus view) |
