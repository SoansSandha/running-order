# Catalogue search — Design

**Date:** 2026-10-08
**Status:** Draft for review
**Scope:** Plan B of deliverable 2b. Builds on
[2026-10-05-match-review-design.md](2026-10-05-match-review-design.md) (Plan A),
whose decisions still hold except where D27–D30 below change them.

---

## 1. What this is

On the match review screen, one **Search all unmatched** button looks for
every unmatched song's twin in the *other service's whole catalogue*: each
"Only on Spotify" song on YouTube Music, each "Only on YouTube" song on
Spotify. What it finds is proposed on the board exactly like a pair from the
two playlists, and the user confirms or rejects it. A confirmed find is kept
in the match book, so Plan C can add the missing track to the playlist that
lacks it.

**Why:** Pair with… (Plan A, D25) can only offer the other playlist's
leftovers. When a song is not in the other playlist at all — the usual case —
nothing it offers can be right.

**Read-only.** Plan B writes nothing to Spotify or YouTube. Searching is a
read.

**Done when:** on the real Punjabi Songs pair, the button finds YouTube Music
twins for the "Only on Spotify" songs at the rate measured in §3 with no wrong
pair settled; confirming, rejecting and picking a near miss all work; a
confirmed find is still settled after a reload; and the owner's test
playlists behave sensibly in both directions.

---

## 2. Decisions

Continuing the numbering in the mirror and match review designs.

| # | Decision | Rejected | Why |
|---|---|---|---|
| D27 | **One "Search all unmatched" button** searches every unmatched song on both sides. Replaces D24's per-row, on-demand search | Searching automatically on every load; a search per row | The owner's choice. A per-row search makes the user do the sweep by hand; an automatic one spends a few hundred searches every time the board opens, against a Spotify rate limit that is not published |
| D28 | **Every search result is judged by `scorePair`**, the matcher already audited against both real libraries. An accepted result is a proposal like any other pair. A refused result is offered as a near miss in Pair with… | Auto-confirming an ISRC hit that scores strong (spotDL's rule); commercial-style weighted fuzzy scoring with an 80% threshold | Auto-confirming breaks D15 — every pair is a proposal until a human confirms it — and Plan C writes from confirmed pairs. Fuzzy scoring would discard the audited rules for remixes, sequels, "2.0" and non-Latin titles; the near misses it would catch reach the user through Pair with… instead |
| D29 | **A confirmed find carries a snapshot of the found track** in its match-book record | Re-searching after a reload; a separate store | The found track is in neither playlist, so after a reload nothing else knows its title, artists or length. Plan C needs its id to add it |
| D30 | **Spotify → YouTube Music searches by ISRC first**, then by title and artist | Title and artist only (sigma67/spotify_to_ytmusic, FreeYourMusic) | Measured in §3: the ISRC query supplied 76 of the 92 matches found. It is undocumented YouTube behaviour (ytmusicapi issue #144, used by spotDL), so the title search stays as the fallback and nothing breaks if it stops working |

---

## 3. What was measured

A throwaway probe on 2026-10-08 searched YouTube Music (unauthenticated,
ytmusicapi 1.12.3) for all 111 "Only on Spotify" songs of the real Punjabi
Songs pair — 106 with an ISRC, 5 local files — using the cascade in §4, and
judged every result with `scorePair`.

| Outcome | Songs |
|---|---|
| Strong match found | 88 |
| Likely match found | 4 |
| Nothing `scorePair` accepts | 19 |

- The ISRC query's top result was accepted for 69 of the 106 songs. When it
  misses, it returns an unrelated song (Toby Fox for *Na Na Na*, a French
  chanson for *Akh Lag Gayi*), which `scorePair` refuses.
- The 92 accepted matches came from: ISRC 76, "title artist" songs 12,
  videos 4. Every accepted match whose title is not identical was checked by
  eye and is right; the rest share title, artist and length.
- About 6 of the 19 are on YouTube Music under a different mix name —
  *Parda Hata Do – Farooq Got Audio Mix* is *Parda Hata Do – Trap Mix* by
  Farooq Got Audio; *Mere Wargi (Remix)* by Smoke ride is *Mere Wargi (Remix By
  Smoke Ride)*. `scorePair` refuses them by design; they are the near misses
  Pair with… must offer. The rest look absent or are different edits
  (*Kinna Sohna* 252s against 475s).

The other direction could not be probed without the owner's Spotify login.
It is measured in the walkthrough (§9).

How other tools do this, for the record: commercial transfer services search
the target catalogue, use ISRC where the target exposes it (YouTube Music
does not), fall back to title and artist, and prefer leaving a song unmatched
to guessing (FreeYourMusic documents this; Soundiiz states it). The open-source
converters search "artist title", rank "song" results above videos, and mostly
accept the top result with no rejection path.

---

## 4. Searching

### Spotify → YouTube Music

For each "Only on Spotify" song, stop at the first step that yields a
**strong** result:

1. The ISRC as the query, filter `songs`, top 3 — only when the song has one.
2. `"<title> <primary artist>"`, filter `songs`, top 5.
3. The same text, filter `videos`, top 3.

Results already in the YouTube playlist are skipped: the playlist pairing has
already judged them.

### YouTube Music → Spotify

For each "Only on YouTube" song, stop at the first step that yields a
**strong** result:

1. `track:"<title>" artist:"<primary artist>"`, 10 results.
2. `<title> <primary artist>`, 10 results.

10 is Spotify's maximum for a development-mode app since February 2026
(developer.spotify.com, February 2026 changelog). YouTube has no ISRC, so
there is no ISRC step. The title is first read past YouTube's decoration and
a leading artist credit — `Sheesha | Karan Aujla | J Statik | … | New Punjabi
Song 2022` searches as `sheesha` — using the essential-title reading
`scorePair` already applies (`essentialTitle`), now exported for this.

Results already in the Spotify playlist are skipped.

### Skipped songs

Local-file Spotify songs are searched by text (they have no ISRC). Episodes
and unavailable rows are not searched: there is no title to search for. A
song that already has a confirmed find in the match book is not searched
again.

### Running it

- **YouTube and Spotify search side by side,** each one song at a time. The
  progress line counts songs, not requests: "Searching 34 of 189".
- **Results land row by row.** Each finished song reruns settling (§5), which
  is cheap.
- **Stop** ends the sweep after the request in flight, whose result is
  dropped. Choosing another YouTube playlist, or leaving the screen, stops it
  too.
- **Results live only for the open review.** Unconfirmed finds are gone after
  a reload or a playlist switch; press the button again.

### The pieces

- **Proxy:** one read-only route, `GET /search?q=&filter=songs|videos&limit=`,
  passing ytmusicapi's results through. It holds no logic (D13).
- **YouTube client:** `search(query, filter, limit)`. Search results carry no
  `setVideoId`, so they are normalized by a variant of
  `normalizeYouTubeTracks` that does not require one; a `songs` result with no
  `videoType` is read as an album track (ATV).
- **Spotify:** `searchTracks(client, query)` through the existing client, which
  already waits out a 429's `Retry-After`. Results are normalized by
  `normalizePlaylistItem`.
- **`src/match/findTwin.js`**, pure: given a track and an injected search
  function, it runs the cascade and returns
  `{ candidates, nearMisses }` — candidates are accepted results with tier,
  drift and reason, best first; near misses are refused results, in search
  order. No network, so it is unit-tested with recorded results.

---

## 5. Settling finds

Plan A's `settlePairs` is unchanged: it pairs the two playlists. A new
`settleFound` runs after it, on its leftovers only:

- Each unmatched Spotify song takes its best found YouTube candidate, and each
  unmatched YouTube song its best found Spotify candidate, skipping any the
  match book says is `different`.
- A found track wanted by two songs goes to the stronger claim, by the same
  tier-then-drift order `settlePairs` uses.
- An unmatched song with a `same` decision carrying a snapshot (D29) — whose
  found track is not in the other playlist — becomes a **certain** pair with
  the track rebuilt from that snapshot. This is how a confirmed find survives
  a reload with no search.
- A song with nothing found stays unmatched, and its search near misses join
  Pair with….

A found pair has the same shape as any pair, plus which playlist lacks the
found track: `missingFrom: 'youtube' | 'spotify'`.

---

## 6. The board

- **Finds join Strong and Likely** like any pair. The found track's cell says
  so in its secondary line: "Not in your YouTube playlist" or "Not in your
  Spotify playlist". **Confirm all strong** includes them.
- **Reject** moves the song to its next found candidate, or back to unmatched.
- **Pair with…** on an unmatched row lists that row's search near misses
  first, under "Search results", then the other playlist's leftovers, closest
  title first. "Only on YouTube" rows get the same picker, listing Spotify
  near misses and the unmatched Spotify songs.
- **Settled** shows confirmed finds with the same marker, and Undo.
- **The lever row** holds **Search all unmatched** beside Confirm all strong.
  While a sweep runs, it shows the progress line, a meter and **Stop**. At the
  end, if any searches failed, "N searches failed".
- Rows are keyed by their playlist-side track: a found track's position in a
  search result is not unique.

---

## 7. The match book

A `same` decision about a found track gains a `found` snapshot of that track:

```js
{ spotifyKey, youtubeVideoId, verdict: 'same', decidedAt,
  found: { side: 'youtube' | 'spotify', name, artists: [name…], durationMs,
           videoType?, uri? } }
```

`side` names which side the snapshot describes; `uri` is the Spotify URI a
Plan C add needs. Decisions without `found` — every Plan A decision — load
and behave exactly as before. A `found` that is not an object is dropped on
load; the decision itself is kept.

---

## 8. When things go wrong

| Situation | What the review screen shows |
|---|---|
| Proxy not running, or the YouTube session expired | The YouTube half stops with the existing message; the Spotify half carries on |
| Spotify rate limit (429) | The client waits out `Retry-After`, as it does for writes |
| Spotify session cannot be refreshed | The Spotify half stops with a red notice; the YouTube half carries on |
| One search fails | That song is skipped and counted; "N searches failed" at the end |
| The board changes during a sweep (a decision, a Stop) | The sweep continues on the songs it started with; settling reruns |

---

## 9. Testing

- **Unit, test-first:**
  - **`findTwin`**, with real recorded results verbatim: an ISRC miss that
    returns an unrelated song (*Na Na Na*) falls through to text; a match found
    only among videos (*AJA*); a mix-name near miss (*Parda Hata Do*); a result
    already in the playlist is skipped; the cascade stops at the first strong.
  - **`settleFound`:** rejecting the best find moves to the next; two songs
    wanting one found track; a snapshot rebuilds a certain pair; a song paired
    in the playlists is never touched.
  - **Match book:** a `found` snapshot round-trips; a Plan A book still loads.
  - **The YouTube query title:** decoration and a leading credit removed.
  - **Proxy:** `/search` passes results through, rejects an unknown filter,
    and never leaks the exception text (pytest).
- **Real-library gate:** replaying the recorded results of §3 through
  `findTwin` reproduces exactly 88 strong, 4 likely and 19 with nothing. The
  recorded YouTube library carries no video ids, so the replay skips nothing
  as already in the playlist — as the probe did.
- **The walkthrough** is the gate for the screen, and it also covers Plan A's
  unrun walkthrough. The owner runs it on the real Punjabi Songs pair and on
  the test playlists, in both directions.

---

## 10. Not in Plan B

| Item | Where it goes |
|---|---|
| Adding found songs to either playlist; reordering YouTube | Plan C (D23) |
| Keeping unconfirmed results across reloads | When re-searching is missed |
| Auto-confirming any find | Not planned (D28) |
| Searching other services (Apple Music, Tidal) | Not planned |
