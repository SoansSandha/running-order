# Mirror run — Design

**Date:** 2026-10-11
**Status:** Built 2026-10-12, and checked live on "test punjabi songs" (§9)
**Scope:** Deliverable 2c of
[2026-09-18-youtube-mirror-design.md](2026-09-18-youtube-mirror-design.md)
(the match review designs call it Plan C). It acts on what
[2026-10-05-match-review-design.md](2026-10-05-match-review-design.md),
[2026-10-08-catalogue-search-design.md](2026-10-08-catalogue-search-design.md),
[2026-10-10-match-tray-design.md](2026-10-10-match-tray-design.md) and
[2026-10-11-no-match-design.md](2026-10-11-no-match-design.md) settle. Their
decisions still hold except where D48–D55 below change them. The mirror
design's §10 and §11 are the starting point; this document makes them
concrete.

---

## 1. What this is

One action on the review screen, **Update YouTube**, makes the chosen YouTube
playlist match the Spotify playlist:

1. songs settled as "Not in your YouTube playlist" are added to YouTube;
2. songs settled as "Not in your Spotify playlist" are added to the end of
   Spotify (D23, D49);
3. YouTube is reordered into Spotify's order, with songs only on YouTube at
   the bottom. This step can be switched off (D51).

The order copied is the Spotify playlist's current order. Sorting Spotify
stays where it is, on its Sort screen.

**This is the first deliverable that writes from the review.** Everything
before it was read-only. So it follows the product principles to the letter:
a preview first (Principle 1), every track accounted for (Principle 2), and
progress, Stop and Undo throughout (Principle 5).

**Testing** uses the playlist "test punjabi songs" on the owner's test
profiles in Spotify and YouTube Music. Every write to it needs the owner's OK
first (CLAUDE.md, live checks).

**Done when:**
- the proxy refuses a write from any origin but the app's, and any request
  addressed to a host other than `127.0.0.1` or `localhost`;
- on "test punjabi songs", **Update YouTube** adds every settled find to its
  playlist, and YouTube ends in Spotify's order, with songs only on YouTube
  and marked songs at the bottom;
- the run's final check reports that YouTube shows the order written;
- **Undo** removes exactly the songs the run added, from both playlists, and
  puts YouTube's order back; after a reload both playlists are as they
  started;
- the layout check (`scripts/check-columns.js`) reports `{}`.

---

## 2. Decisions

Continuing the numbering in the earlier designs.

| # | Decision | Rejected | Why |
|---|---|---|---|
| D48 | **The proxy guards with the browser's own headers.** Every route checks the `Host` header (`127.0.0.1` or `localhost` only). Every write checks `Origin` is the app's (`http://127.0.0.1:5173`), and a write with no `Origin` is refused. Write bodies are JSON. Settles the mirror design §5's "decide before 2c" | A shared secret the app sends; accepting the `127.0.0.1` bind alone | The owner's choice. The realistic threat is a web page the owner visits: DNS rebinding reaches a localhost port as if same-origin, and the Host check defeats it. A secret would not stop a program running as the owner, because that program can read `proxy/browser.json`, which holds the full session cookies. Accepting the bind alone leaves DNS rebinding open, and with writes that means a web page could edit the owner's playlists |
| D49 | **Songs added to Spotify go to its end, in the same run** | A separate "Add to Spotify" step before sorting; leaving Spotify adds out of 2c | The owner's choice. One run does both sides. If the owner wants the new Spotify songs sorted, they re-sort Spotify and run again, and the second run moves only the few songs that changed (D55). Appending keeps every existing song's `added_at` (Principle 3) |
| D50 | **A run needs every row settled.** Strong, Likely and unmatched rows block it; songs marked "not on the other service" do not | Running with what is settled, sinking the rest | The owner's choice. An unanswered row would otherwise land a song in the wrong place. **Confirm all strong** clears most of them in one click, and the match book makes the second run of a playlist almost entirely settled already |
| D51 | **Update in place only, with an "Also reorder" toggle**, on by default. Off, the run adds songs and leaves the order alone | Both modes, with "Create new" (mirror design §10); always reordering | The owner's choice. The review always starts from a YouTube playlist the owner has, so in place covers the flow that exists. "Create new" waits until it is wanted |
| D52 | **The run lives in a panel on the review screen**, above the board, built like the search sweep's section | A screen and route of its own, with a board of YouTube's resulting order | The owner's choice. The resulting order is Spotify's, which the owner read on Sort's preview. What the owner has not seen is what changes: the songs added on each side, the songs sent to the bottom, and how many moves it takes. The panel lists exactly that |
| D53 | **The run checks YouTube's order after writing**, not its display setting before | Reading the playlist's `sortOrder` before ordering (mirror design §5, §14) | Measured in ytmusicapi 1.12.3: `get_playlist` never returns `sortOrder`; only `edit_playlist` can set it. So the setting cannot be read. Reading the order back after the run catches the same problem, and any other way YouTube might not show what was written |
| D54 | **An unfinished run's undo record carries forward.** If a run is stopped or fails, the next run against the same Spotify playlist keeps its `orderBefore` and adds to its lists. A finished run's record, or one for another Spotify playlist, is replaced by the next run's | One record per run, always replaced; one record kept until undone | Stopping, running again, then pressing Undo must reach back to before the first attempt, or the songs it added would be left behind. A record kept until undone would let Undo reach back weeks. A record names one Spotify playlist, so additions to two are never mixed in it |
| D55 | **Every run is rebuilt from the live playlists and the match book**, so running again is how a stopped or failed run resumes | A resume feature | Songs already added are in the playlist, so the rebuilt plan does not add them again; a half-done reorder leaves only the remaining moves. One code path, and it is the one already tested |

**Amended in the mirror design:**
- §10 *Direction* was already superseded by D23. Fill runs both ways.
- §10 *Create new* is deferred by D51.
- §11 says adding items reissues every `setVideoId`. That has never been
  measured. This design does not depend on it either way (§5, step 5), and
  the probe (§9) measures it.

---

## 3. The proxy

### Guards (D48)

- **Host:** Starlette's `TrustedHostMiddleware`, with
  `allowed_hosts=["127.0.0.1", "localhost"]`, on every route. A request
  addressed to any other name is answered 400.
- **Origin:** a small middleware refuses every `POST`, `PATCH` and `DELETE`
  whose `Origin` is not `http://127.0.0.1:5173` with a 403, including a
  request with no `Origin` at all. Reads are left alone, so the existing
  routes are unchanged for the app.
- **JSON bodies:** each write route declares its body as a Pydantic model.
  FastAPI 0.115 reads a body as JSON when its `Content-Type` is JSON or
  absent, and refuses a form-encoded or plain-text one, so a plain HTML form
  posted from another site cannot reach the routes. The Origin check is the
  guard that matters.
- **CORS** gains `DELETE` in `allow_methods`.

### New routes

As thin as the existing ones (D13): they translate and nothing more. On a
failure they drop the cached client and answer 502, never interpolating the
exception's own text (see `get_playlist`).

| Route | Body | Calls | Answers |
|---|---|---|---|
| `POST /playlists/{id}/items` | `{ videoIds: [str] }` | `add_playlist_items(id, videoIds, duplicates=False)` | `{ added: [{ videoId, setVideoId }] }` from `playlistEditResults`. A response without `SUCCEEDED` is a **409**: YouTube refused, and in that case added nothing (with `duplicates=False`, one song already present refuses the whole batch) |
| `PATCH /playlists/{id}/order` | `{ setVideoId: str, beforeSetVideoId: str \| null }` | `edit_playlist(id, moveItem=(setVideoId, beforeSetVideoId))`, or `moveItem=setVideoId` when `beforeSetVideoId` is null | `{ ok: true }` |
| `DELETE /playlists/{id}/items` | `{ items: [{ videoId, setVideoId }] }` | `remove_playlist_items(id, items)` | `{ ok: true }`. Undo is its only caller |

That a move with no successor goes to the end is not documented. The probe
(§9) confirms it before the run depends on it.

---

## 4. The plan

Pure functions in `src/plan/mirror.js`, beside `diff.js` and `clone.js`.
They are built from the matcher's existing steps (`scoreCandidates`,
`settlePairs`, `setAsideMarked`, `settleFound`); nothing in `src/match/`
changes.

Because a run needs every row settled (D50), the whole plan follows from
three things: the Spotify playlist, the YouTube playlist and the match book.
No search state is involved, which is what makes D55 work.

### `planFill(result)`

Takes the review's settled result.

- **`blocked`:** the rows still waiting for the owner: Strong and Likely
  pairs, and the unmatched songs on both sides. Marked songs are not
  counted. Above 0, the run is refused.
- **`addToYoutube`:** the YouTube tracks of settled pairs with
  `missingFrom: 'youtube'`, in the Spotify playlist's order.
- **`addToSpotify`:** the Spotify tracks of settled pairs with
  `missingFrom: 'spotify'`, in the YouTube playlist's order. They are
  appended to Spotify's end (D49).

### `mirrorOrder(spotifyTracks, youtubeTracks, pairs)`

Takes both playlists **after** the songs were added, and the pairs settled
from them. Returns the YouTube tracks in their target order:

1. down the Spotify playlist, each song's paired YouTube item;
2. then every YouTube item in no pair (only on YouTube, or marked), in its
   current relative order.

The result is always a permutation of `youtubeTracks`. Pairs join playlist
items, not song ids, so a song listed twice on either side places correctly
without a special case: a Spotify copy with no YouTube item is skipped, and
a second YouTube copy in no pair goes to the bottom.

### The preview's move count

The real moves exist only after the songs are added and YouTube is re-read
(§5, step 5), because YouTube decides where added items land: a playlist can
be set to add to the top. The preview estimates by placing the songs to add
at the end of YouTube's current list, and says "about N moves".

### Items YouTube will not return

The 3 items the real playlist counts but never returns (mirror design §6)
are in no list, so in no plan. They stay wherever they are, and the preview
says so.

---

## 5. The run

`executeMirror` in `src/plan/executeMirror.js`, with the readers, the two
writers and the storage injected, as `executeReorder` takes its writer.

**Before writing**

1. **Guard.** Re-read both playlists and rebuild the plan. If the Spotify
   playlist's URIs, in order, or the YouTube playlist's `setVideoId`s, in
   order, differ from those the preview was built from, write nothing. The
   panel says "A playlist changed since the preview. It has been re-read:
   check the new preview." and the review reloads.
2. **Save the undo record** (§6), before the first write.

**Writing**

3. **Add to Spotify,** in chunks of 100. Each chunk's URIs go into the
   record before its request is sent, so an add whose answer is lost is
   still undone.
4. **Add to YouTube,** in chunks of 50. YouTube's limit per request is not
   published; the probe measured 50 accepted and answered (§9). Before each
   request the chunk goes into the record as `{ videoId, setVideoId: null }`.
   When the answer lands, those entries take the answered ids. A refusal
   (409: nothing in that request was added) takes them out again.
5. **Re-read both playlists, and pair again** against the match book. Every
   find is now in both playlists, so it pairs as an ordinary pair (a `same`
   verdict settles a pair without the matcher, match review §5), and
   `mirrorOrder` sees only `setVideoId`s read after the adds. YouTube's read
   waits, for up to about 15s, until every song just added shows: a bulk
   write reads back late (§9). This step always runs. It is what keeps a move from naming an item id from before
   an addition (mirror design §10).
6. **Reorder YouTube,** when "Also reorder" is on: `executeReorder` with the
   YouTube writer and `keyOf: (track) => track.itemId`, one move per request.
7. **Check.** Re-read YouTube, up to 5 times 2s apart, until its order
   matches the target: a read right after a move shows a passing state (§9).
   If it never matches, the result is amber, not green (§7). Stop during the
   check, or a check read that fails, ends the run with no verdict on the
   order, since every write has landed. If a song added in steps 3–4
   did not pair in step 5, it is named in the result too.

The record is marked `finished` when step 7 ends.

**Stop** takes effect between requests. Stopping after the adds leaves a
playlist that has every song and is not yet ordered: valid, and the right
failure (mirror design §10).

**A failing write** ends the run. The result says how far it got: "Added 83
to YouTube and 4 to Spotify. Moved 120 of 212, then YouTube refused a move."
Undo covers whatever the record holds. An expired YouTube session reads as
"Could not reach YouTube Music." (§10).

**Running again** rebuilds everything from the live playlists (D55).

**After the run,** finished or not, the review reloads the YouTube playlist
and the app re-reads the Spotify playlist, so the board shows the songs as
pairs from the two playlists and Sort shows the songs added to Spotify.

---

## 6. Undo

### The record

Kept in `localStorage` under `playlist-sorter:mirror-undo:<youtubePlaylistId>`,
with the try/catch handling and injected storage of `src/plan/undo.js`:

```js
{
  version: 1,
  youtubePlaylistId, spotifyPlaylistId,
  orderBefore: [videoId…],                       // YouTube, before the run
  addedToYoutube: [{ videoId, setVideoId }…],  // setVideoId null until the add answers
  addedToSpotify: [uri…],
  reordered: false,                              // true once the run starts reordering
  finished: false,
  createdAt,
}
```

One record per YouTube playlist. A run that finds an unfinished record for
the same Spotify playlist carries it forward (D54); otherwise it starts a
fresh one.

When nothing is left at all (no rows pending, nothing to add, no moves),
an unfinished record is marked finished, so it cannot carry into a much
later run. The "Also reorder" toggle is not consulted: unticking it to look
must not close an attempt that still has moves to make.

The panel holds the record in memory as well. When the browser refuses to
store it, Undo still works until the owner leaves the review screen, as
decisions in the match book do.

### Undoing

1. **Remove the recorded additions from YouTube,** in chunks of 50.
   - Each chunk is resolved against a settled read: two reads 2s apart that
     agree, since a recent move reads back late (§9).
   - An entry is matched by its recorded `setVideoId`. If the playlist no
     longer has it, the item is gone (ids never change, §9).
   - Only an entry recorded without an id (an add whose answer was lost) is
     looked for by its `videoId`, one copy per entry.
   - Nothing outside the record is touched, so a song the owner added by
     hand stays (D17).
   - After each chunk, Undo reads again, for up to about 15s, until the
     removed items no longer show. If some still do, it stops with "YouTube
     Music kept N of the songs Undo removed. Undo again to retry."
2. **Remove the recorded URIs from Spotify.**
   `// ponytail:` Spotify removes every copy of a URI, so a copy of the same
   song the owner added by hand after the run goes too. Handling it means
   tracking Spotify positions; it is recorded as a ceiling instead.
3. **Restore YouTube's order:** `buildRestoreOrder` gains a `keyOf` option
   (default `(track) => track.uri`, today's behaviour). It is given the
   record's `orderBefore` as its key list, with `(track) => track.id`, the
   `videoId`, from a settled read. `executeReorder` runs the moves. Songs
   added since the record go to the bottom, as Spotify's undo does. This step
   is skipped when the run never reordered (`reordered: false`), so a
   reorder-off run's Undo leaves the owner's own reordering alone.
4. **Delete the record** once all three succeed.

A removal leaves the record only once it is confirmed: for YouTube, once a
read shows it gone; for Spotify, once its request answers. So a stopped or
failed undo keeps a record of everything that may still be there, Undo
stays offered, and pressing it again drops what is already gone.

Undo shows what it will do before it runs ("Remove 83 from YouTube and 4
from Spotify, and put YouTube's order back", the order clause only when the
run reordered), then runs with progress and Stop.

Spotify's remove call on `/playlists/{id}/items` takes
`{ items: [{ uri }] }`, as the probe measured (§9).

---

## 7. On the screen

**The panel (D52)** sits above the board, below the search sweep's section,
and uses the existing chrome (`Notice`, `Meter`, `Lever`, `QuietLever`) and
`review.css`.

| State | Shows |
|---|---|
| No YouTube playlist chosen | Nothing |
| Rows still pending | "Settle N more songs first". **Update YouTube** is disabled |
| Songs to add to a Spotify playlist the owner cannot edit | "This Spotify playlist isn't yours to add to." **Update YouTube** is disabled |
| Ready | "Add 83 to YouTube · Add 4 to Spotify · about 212 moves". Two collapsed lists, **Songs to add** (each with the playlist it goes to) and **Going to the bottom**. The **Also reorder** toggle; off, the moves read "Order left as it is" and **Going to the bottom** hides. When they apply: "3 items YouTube won't show us stay where they are." and, in amber, "Undo will last only until you leave this screen: this browser isn't keeping site data." |
| Nothing to do | "YouTube already matches." with reordering on, "Nothing to add." with it off. Lever disabled |
| Running | The phase ("Checking both playlists", "Adding to Spotify", "Adding to YouTube", "Reading both playlists", "Moving 120 of 212", "Checking the result") on a `Meter`, **Stop**, and "Deciding waits until the update ends or is stopped." |
| Done | Green: "Added 83 to YouTube and 4 to Spotify. Moved 212." Amber instead when the check found a different order: "YouTube shows a different order than the one written. If this playlist is set to sort by date in YouTube Music, set it to Manual and run again." **Undo** |
| Failed | Red: how far it got (§5). **Undo** |
| The re-read after a run fails | Amber: "The board may be out of date". The playlists could not be read again; choose the YouTube playlist again, or reload, before running again |
| An undo record exists, nothing running | **Undo last update**, also after a reload |

**Update YouTube** sits in the bottom lever row beside **Confirm all
strong**.

**While a run or an undo is going** (as D46 holds Progress):
- the back button hides, and back or forward puts the review URL straight
  back;
- the "Match against" dropdown, **Search all unmatched** and every decision
  lever on the board wait, with the existing note.

**At 680px or less** the panel stacks, and `scripts/check-columns.js`, with
the panel open in its Ready state, must still report `{}`.

---

## 8. The pieces

| Piece | What it does | Tested by |
|---|---|---|
| `proxy/app.py` | §3: the two guards, the three routes, `DELETE` in CORS | pytest: a foreign `Host` refused on a read; a write with a foreign `Origin`, and with none, refused; a form-encoded write refused; each route's call and answer; a refused add is a 409; no exception text in any error |
| `src/services/youtube/client.js` | `addItems`, `moveItem`, `removeItems`, sending JSON | Unit tests against a fake `fetch`: paths, methods, bodies; a 409 surfaces as its own error |
| `src/services/youtube/writer.js` (new) | The writer contract for YouTube: `reorder(playlistId, op)` sends `op.key` and `op.beforeKey`; `addTracks` in chunks of 50, returning what was added; `removeTracks` | Unit tests against a fake client, including the contract `executeReorder` relies on |
| `src/services/spotify/mutations.js`, `writer.js` | `removeTracks(client, playlistId, uris, snapshotId)` and the writer's `removeTracks` | Unit tests against a fake client |
| `src/plan/mirror.js` (new) | §4: `planFill`, `mirrorOrder`, the move estimate | Unit tests: `blocked` counts each pending kind and not marked songs; both add lists and their order; `mirrorOrder` is always a permutation; songs only on YouTube keep their relative order at the bottom; a song listed twice on each side |
| `src/plan/executeMirror.js` (new) | §5's run and §6's undo, with readers, writers and storage injected | Unit tests with fakes: the guard writes nothing when a playlist changed; the record is saved before the first write and grows per chunk; **no move names a `setVideoId` from before the adds** (mirror design §12, asserted directly); Stop between phases; a failure's report and record; an unfinished record carried forward, and a finished one or one for another Spotify playlist replaced; a stopped undo's record holds only what is left to remove; undo removes exactly the recorded additions and leaves a hand-added copy; undo falls back to `videoId` for a reissued `setVideoId`; the check's mismatch |
| `src/plan/undo.js` | `keyOf` on `buildRestoreOrder`; the mirror record's load, save and clear | Unit tests: the existing tests unchanged; restore by `videoId`; blocked storage |
| `src/ui/useMirrorRun.js` (new) | The panel's state: preview, run, Stop, undo, the URL hold | The walkthrough |
| The review screen, and its panel | §7 | The layout check and the walkthrough |
| `scripts/check-columns.js` | Seeds a Ready panel before measuring | Running it: it must report `{}` |

---

## 9. Testing

- **Unit, test-first:** every row of §8's table that names unit tests, and
  pytest for the proxy.
- **The layout check** must report `{}`.
- **Browser:** demo mode has no YouTube side, so the panel is checked live,
  on the test profiles, with 0 console errors.

**Live checks. Each writes to the test playlists, so each needs the owner's
OK first.**

1. **The probe,** before the run code relies on what it measures. On "test
   punjabi songs":
   - add one song to the YouTube playlist, read it back, move it to the end
     with no successor, move it back, remove it. This settles: a move with no
     successor goes to the end; whether adding reissues other items'
     `setVideoId`s; where an added item lands;
   - add a batch of 50 to a YouTube playlist and remove them, to confirm the
     chunk size. If refused, the chunk size drops and the probe is re-run;
   - add one song to the Spotify playlist and remove it, to settle the remove
     call's body.
   The results are written into this section, as the earlier designs record
   their measurements.

   **Measured** on 2026-10-12, against "test punjabi songs" (386 YouTube
   items, 413 Spotify tracks), from the owner's Chrome through the proxy.
   The probe ran twice: once as planned, then the move steps again with
   every read polled until it settled.

   | Question | Answer |
   |---|---|
   | What an add answers | `{ videoId, setVideoId }` for each song added |
   | Where an added song lands | At the end (index 386 of 387) |
   | Whether adding reissues other items' `setVideoId`s | No. Every existing item kept its id |
   | Whether a move reissues the moved item's `setVideoId` | No. It kept its id at the top and at the end |
   | A move with no successor | Goes to the end |
   | 50 videos in one add | Accepted: 50 added and answered, then 50 removed in one request |
   | Whether a removal reissues ids | No. After every removal, the playlist read back identical, ids included |
   | How fast a read reflects a write | An add or a removal: on the first read (about 1.5s). **A move: the first read shows a passing state** (the moved item missing, 386 rows; or listed twice, 388 rows). It is right by the second read, about 5s after the move |
   | Spotify's removal body on `/playlists/{id}/items` | `{ items: [{ uri }] }`: 200, and the song was gone |
   | Both playlists afterwards | Unchanged, ids included, after both runs |

   What this changes:
   - **The check after the reorder** (§5, step 7) reads again until the
     order settles, for up to about 10s, before calling it different.
     Otherwise a passing state reads as a different order on almost every run.
   - **Undo matches recorded additions by `setVideoId`**, and falls back to
     the `videoId` only for entries recorded without one (an add whose
     answer was lost). Ids proved stable, so a recorded id that is gone
     means the item is gone, and a copy the owner added by hand is never
     taken in its place (D17).
2. **The full run,** on "test punjabi songs" in both services: the preview's
   counts are checked against the board, the run completes, and the check is
   green. Then **Undo**, a reload, and both playlists are confirmed to be as
   they started. If Undo is not offered or fails, testing stops and the owner
   is told exactly what state each playlist is in.
3. **Stop and run again:** stop during the reorder, run again, and confirm it
   finishes; then Undo returns to before the first attempt (D54).

---

## 10. When things go wrong

| Situation | What happens |
|---|---|
| Proxy not running | The existing `ProxyUnavailableError` notice; nothing written |
| YouTube session expired | The run stops where it is, with the proxy's "Could not reach YouTube Music." A failing write cannot tell a dead session from a dead network, as with playlist reads (mirror design §14); the review's Try again then reports the expired session. Undo covers what the run did. |
| A playlist changed since the preview | Nothing written; the review reloads (§5, step 1) |
| YouTube refuses an add (409) | That chunk added nothing. The run stops and reports; earlier chunks are in the record |
| A move fails | The run stops and reports how far it got. Running again resumes (D55) |
| The Spotify playlist is not the owner's, with songs to add to it | The run is refused before writing (§7) |
| The browser blocks storage | The preview warns; the run is allowed; Undo works until the owner leaves the review screen (§6) |
| YouTube shows a different order after the run | Amber result with the Manual setting hint (D53) |
| An added song does not pair on the re-read | It goes to the bottom with songs only on YouTube, and the result names it |

---

## 11. Not in this plan

| Item | Where it goes |
|---|---|
| "Create new": a fresh YouTube playlist in Spotify's order | When it is wanted (D51) |
| Sorting the songs added to Spotify into place | The owner's Sort screen, then run again (D49) |
| Running with rows unsettled | Not planned (D50) |
| A shared secret on the proxy | If the tool ever runs on a machine shared between accounts (D48) |
| Undo for more than the last run | Not planned (D54) |
| Remembering which YouTube playlist goes with a Spotify playlist | When it is missed (D26) |
