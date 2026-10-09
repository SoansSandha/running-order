# Catalogue Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One "Search all unmatched" button on the match review screen that looks for every unmatched song's twin in the other service's whole catalogue, proposes what it finds on the board, and remembers a confirmed find across reloads.

**Architecture:** A read-only proxy route and a Spotify search call feed one pure module, `src/match/findTwin.js`, which runs a search cascade (ISRC first towards YouTube) and judges every result with the existing `scorePair`. A second pure module, `src/match/settleFound.js`, settles finds on the leftovers of Plan A's `settlePairs`, so playlist pairing never changes. The match book gains a snapshot of a confirmed find's track. The hook runs the sweep through a small, separately tested loop (`src/ui/sweep.js`), and the screen shows finds in the existing Strong and Likely groups.

**Tech Stack:** React 19 (JavaScript, not TypeScript), Vite 8, Vitest 3, Oxlint; the Python proxy is FastAPI + ytmusicapi 1.12.3, tested with pytest.

**Spec:** [docs/2026-10-08-catalogue-search-design.md](../../2026-10-08-catalogue-search-design.md). It builds on [docs/2026-10-05-match-review-design.md](../../2026-10-05-match-review-design.md) (Plan A, already on this branch). Read both before starting.

## Global Constraints

- **Read-only.** No code in this plan may write to Spotify or YouTube. The only new proxy route is `GET /search`.
- **No new dependencies.** `package.json` and `proxy/requirements.txt` do not change.
- The match book's storage key stays exactly `playlist-sorter:match-book`. A Plan A decision (no `found` field) must load and behave exactly as before.
- Spotify search asks for at most **10** results: the development-mode maximum since February 2026.
- `npm run lint` currently reports exactly two warnings, in `src/ui/components/Flap.jsx` and `src/auth/useAuth.js`. It must report no others.
- **DESIGN.md rules:**
  - Colour only states a fact: amber is pending, green is committed/settled, red is an error (the Quarantined Colour Rule).
  - Every numeral is in a `.num` element.
  - Corners are square everywhere.
  - No new shadows.
  - Condensed uppercase is for labels, controls and headings only; prose is sentence case.
  - Each screen declares its board grid once per breakpoint, on its `.board-*` class.
- Always `git add` explicit paths, never `git add -A` or `git add .`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands, from the repo root: `npm test` (all JavaScript tests: 582 pass before this plan, 624 after it), `python -m pytest proxy` (18 pass before, 21 after Task 1), `npm run lint`, `npm run build`.

## Review Focus

The ways this most likely breaks for a real user, each pinned by a test or a walkthrough step in the task that owns it:

1. **A YouTube row whose artist name holds a double quote, or that has no artist at all.** Spotify's `track:"…" artist:"…"` syntax must stay intact. Pinned in Task 3 (`findOnSpotify` tests).
2. **The same Spotify song listed twice, both unmatched.** One search serves both; one find is claimed, and the other copy stays unmatched. Pinned in Task 4 (`settleFound` test) and Task 5 (the hook's `unsearched` dedupes by key).
3. **A wrong Reject of a find.** It must be repairable: the rejected track is still offered under "Search results" in that song's Pair with…. Pinned in Task 5 (`searchOptionsOf` includes every candidate) and walkthrough step 18.
4. **Choosing another YouTube playlist, pressing Stop, or leaving the screen mid-sweep.** No result from the old sweep may land. Pinned in Task 5 (`sweepHalf` test "once stopped…") and walkthrough steps 20–21.
5. **The proxy dying mid-sweep.** The YouTube half stops with its own message, and the Spotify half carries on. Pinned in Task 5 (`sweepHalf` test "a fatal failure…") and walkthrough step 22.

---

### Task 1: YouTube Music search through the proxy

**Files:**
- Modify: `proxy/app.py` (import `Query`; append the `/search` route)
- Modify: `proxy/test_app.py` (add `search` to `RaisingYT`; append three tests)
- Modify: `src/services/youtube/client.js` (add `search`)
- Modify: `src/services/youtube/client.test.js` (two tests)
- Modify: `src/services/youtube/track.js` (split the per-row mapping out; add `normalizeYouTubeSearchResults`)
- Modify: `src/services/youtube/track.test.js` (import; two tests)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `GET /search?q=&filter=songs|videos&limit=1..20` → `{ results: [...] }`: ytmusicapi's search dicts, passed through and cut to `limit`. 400 for another filter, 502 when YouTube fails.
  - `youtube.search(query, filter, limit) → Promise<Array>`: the raw `results`.
  - `normalizeYouTubeSearchResults(rawResults) → Track[]`: like `normalizeYouTubeTracks`, but needs no `setVideoId` (`itemId` is `null`) and drops a result with no `videoId`.

- [ ] **Step 1: Write the failing proxy tests**

In `proxy/test_app.py`, add a `search` method to the existing `RaisingYT` class, directly after its `get_library_playlists` method:

```python
    def search(self, query, filter=None, limit=20):
        raise RuntimeError(self._message)
```

Then append to the end of the file:

```python


class SearchYT:
    def __init__(self, results):
        self._results = results
        self.calls = []

    def search(self, query, filter=None, limit=20):
        self.calls.append({"query": query, "filter": filter, "limit": limit})
        return self._results


def test_search_passes_results_through_cut_to_the_limit(client, monkeypatch):
    # ytmusicapi returns at least `limit` results, often more.
    results = [{"videoId": f"v{i}", "title": f"t{i}", "videoType": "MUSIC_VIDEO_TYPE_ATV"} for i in range(20)]
    fake = SearchYT(results)
    monkeypatch.setattr(proxy, "get_client", lambda: fake)
    body = client.get("/search", params={"q": "INT102400308", "filter": "songs", "limit": 3}).json()
    assert body == {"results": results[:3]}
    assert fake.calls == [{"query": "INT102400308", "filter": "songs", "limit": 3}]


def test_search_refuses_an_unknown_filter(client, monkeypatch):
    fake = SearchYT([])
    monkeypatch.setattr(proxy, "get_client", lambda: fake)
    assert client.get("/search", params={"q": "x", "filter": "podcasts"}).status_code == 400
    assert fake.calls == []


def test_search_failure_is_clean_and_drops_the_cached_client(client, monkeypatch):
    monkeypatch.setattr(proxy, "_client", RaisingYT())
    response = client.get("/search", params={"q": "x"})
    assert response.status_code == 502
    assert "leaky detail" not in response.text
    assert proxy._client is None
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python -m pytest proxy -q`
Expected: 3 FAIL (the route does not exist, so `/search` answers 404), 18 pass.

- [ ] **Step 3: Add the route**

In `proxy/app.py`, change `from fastapi import FastAPI, HTTPException` to `from fastapi import FastAPI, HTTPException, Query`. Then append to the end of the file:

```python


SEARCH_FILTERS = ("songs", "videos")


@app.get("/search")
def search(q: str, filter: str = "songs", limit: int = Query(5, ge=1, le=20)) -> dict:
    """Catalogue search results, passed through exactly as ytmusicapi returns them.

    As thin as the playlist routes (D13): which query to send, and what a
    result is worth, are decided in JS (src/match/findTwin.js). ytmusicapi
    returns at least `limit` results and often more, so they are cut here.
    """
    if filter not in SEARCH_FILTERS:
        raise HTTPException(status_code=400, detail="Unknown search filter.")
    try:
        results = get_client().search(q, filter=filter, limit=limit)
    except Exception:
        reset_client()
        # Never interpolate the exception's own string (see get_playlist).
        raise HTTPException(status_code=502, detail="Could not reach YouTube Music.")
    return {"results": results[:limit]}
```

- [ ] **Step 4: Run the proxy tests to verify they pass**

Run: `python -m pytest proxy -q`
Expected: 21 passed.

- [ ] **Step 5: Write the failing client and normalizer tests**

In `src/services/youtube/client.test.js`, insert these two tests directly before the test named `'throws ProxyUnavailableError when the proxy cannot be reached'`:

```js
  test('searches with the query, filter and limit encoded', async () => {
    const fetchImpl = vi.fn(async () => ok({ results: [{ videoId: 'v1' }] }))
    const results = await clientWith(fetchImpl).search('Don’t Worry Karan Aujla', 'songs', 5)
    expect(results).toEqual([{ videoId: 'v1' }])
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://127.0.0.1:8787/search?q=Don%E2%80%99t+Worry+Karan+Aujla&filter=songs&limit=5',
    )
  })

  test('a search with no results key is no results', async () => {
    expect(await clientWith(vi.fn(async () => ok({}))).search('x', 'videos', 3)).toEqual([])
  })

```

In `src/services/youtube/track.test.js`, change the import line `import { normalizeYouTubeTracks } from './track.js'` to:

```js
import { normalizeYouTubeSearchResults, normalizeYouTubeTracks } from './track.js'
```

and append to the end of the file:

```js

describe('normalizeYouTubeSearchResults', () => {
  // Title, credit, length and type verbatim from a live search for
  // "AJA Kaléra" (filter videos) on 2026-10-08.
  const AJA_VIDEO = {
    title: 'AJA - Kaléra (Feat. Jaski)',
    artists: [{ name: 'Kaléra', id: null }],
    album: null,
    duration_seconds: 136,
    videoId: 'q7e348rz27I',
    isExplicit: false,
    videoType: 'MUSIC_VIDEO_TYPE_OMV',
    resultType: 'video',
  }

  test('maps a search result onto the Track shape, with no playlist item id', () => {
    const [track] = normalizeYouTubeSearchResults([AJA_VIDEO])
    expect(track).toMatchObject({
      id: 'q7e348rz27I',
      itemId: null,
      name: 'AJA - Kaléra (Feat. Jaski)',
      durationMs: 136000,
      videoType: 'MUSIC_VIDEO_TYPE_OMV',
      source: 'youtube',
      originalIndex: 0,
    })
    expect(track.primaryArtist).toEqual({ id: null, name: 'Kaléra' })
  })

  test('drops a result with no videoId, which can be neither played nor paired', () => {
    const tracks = normalizeYouTubeSearchResults([{ ...AJA_VIDEO, videoId: null }, AJA_VIDEO])
    expect(tracks.map((track) => [track.id, track.originalIndex])).toEqual([['q7e348rz27I', 0]])
  })
})
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run src/services/youtube`
Expected: FAIL. `client.search is not a function`, and `normalizeYouTubeSearchResults is not a function`.

- [ ] **Step 7: Add `search` to the client**

In `src/services/youtube/client.js`, directly after the `fetchPlaylist` method (inside the returned object), add:

```js

    /**
     * Catalogue search, results passed through as ytmusicapi returns them.
     * @param {'songs'|'videos'} filter
     */
    async search(query, filter, limit) {
      const params = new URLSearchParams({ q: query, filter, limit: String(limit) })
      const body = await request(`/search?${params}`)
      return body?.results ?? []
    },
```

- [ ] **Step 8: Split the normalizer**

In `src/services/youtube/track.js`, replace the whole `normalizeYouTubeTracks` function (from `export function normalizeYouTubeTracks(rawTracks) {` to the end of the file) with the code below. The body of `toTrack` is the existing per-row object, unchanged except that `originalIndex` and `itemId` come from its parameters. The JSDoc block above `normalizeYouTubeTracks` stays.

```js
export function normalizeYouTubeTracks(rawTracks) {
  const tracks = []
  for (const raw of rawTracks ?? []) {
    // A row with no setVideoId cannot be addressed by a reorder, and null is
    // the beforeKey end-of-list sentinel — keying on it would corrupt a plan.
    if (!raw?.setVideoId) continue
    tracks.push(toTrack(raw, tracks.length, raw.setVideoId))
  }
  return tracks
}

/**
 * Catalogue search results (Plan B), as Tracks. A result is not a playlist
 * row: it has no setVideoId, so its itemId is null. One with no videoId can be
 * neither played nor paired, and is dropped.
 *
 * @param {Array<object>} rawResults ytmusicapi's search result dicts
 */
export function normalizeYouTubeSearchResults(rawResults) {
  const tracks = []
  for (const raw of rawResults ?? []) {
    if (!raw?.videoId) continue
    tracks.push(toTrack(raw, tracks.length, null))
  }
  return tracks
}

function toTrack(raw, originalIndex, itemId) {
  const artists = (raw.artists ?? []).map((artist) => ({
    id: artist?.id ?? null,
    name: artist?.name ?? '',
  }))
  const primaryArtist = artists[0] ?? null

  const album = raw.album
    ? { id: raw.album.id ?? null, name: raw.album.name ?? '', releaseDate: null, releaseDatePrecision: null }
    : EMPTY_ALBUM

  return {
    id: raw.videoId ?? null,
    // YouTube has no playable URI of Spotify's kind. The Spotify writer's
    // canWrite() reads this, which is why a YouTube Track must not fake one.
    uri: null,
    name: raw.title ?? '',

    artists,
    primaryArtist,
    artistGroupKey: primaryArtist?.id ?? sortKey(primaryArtist?.name),
    artistSortKey: sortKey(primaryArtist?.name),
    showName: null,

    album,
    // No release date is returned at any level, so no album sorts by date.
    releaseDateSortable: null,

    durationMs: (raw.duration_seconds ?? 0) * 1000,
    popularity: 0,
    explicit: raw.isExplicit === true,
    trackNumber: 0,
    discNumber: 0,
    isrc: null,

    addedAt: null,
    originalIndex,

    source: 'youtube',
    itemId,
    // ATV is an album audio track, OMV an official music video, UGC a user
    // upload. The matcher uses it only to break a tie (M3).
    videoType: raw.videoType ?? null,

    isLocal: false,
    isUnavailable: raw.isAvailable === false,
    isEpisode: false,
  }
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run src/services/youtube`
Expected: PASS, every existing test and the four new ones.

- [ ] **Step 10: Run the whole suite and the lint**

Run: `npm test`, `python -m pytest proxy` and `npm run lint`.
Expected: 586 JavaScript tests pass; 21 proxy tests pass; the lint shows only the two existing warnings.

- [ ] **Step 11: Commit**

```bash
git add proxy/app.py proxy/test_app.py src/services/youtube/client.js src/services/youtube/client.test.js src/services/youtube/track.js src/services/youtube/track.test.js
git commit -m "Search YouTube Music through the proxy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Spotify track search

**Files:**
- Create: `src/services/spotify/search.js`
- Test: `src/services/spotify/search.test.js`

**Interfaces:**
- Consumes: the Spotify client's `get(path, { query })` (`src/services/spotify/client.js`), which already waits out a 429's `Retry-After` and throws `AuthError` when the session cannot be refreshed; `normalizePlaylistItem(item, index)` from `src/model/track.js`, which reads the track from `item.track`.
- Produces: `searchTracks(client, query, limit = 10) → Promise<Track[]>`; `SEARCH_LIMIT = 10`.

- [ ] **Step 1: Write the failing tests**

Create `src/services/spotify/search.test.js`:

```js
import { describe, expect, test, vi } from 'vitest'
import { searchTracks } from './search.js'

// A search result as the Web API returns it: a bare track object.
const track = (id, name, artist, durationMs) => ({
  id,
  uri: `spotify:track:${id}`,
  type: 'track',
  name,
  duration_ms: durationMs,
  artists: [{ id: `artist-${artist}`, name: artist }],
  album: { id: 'album-1', name: 'Sheesha', release_date: '2022-06-17', release_date_precision: 'day' },
  external_ids: { isrc: 'GBKQU2290001' },
})

const clientAnswering = (body) => ({ get: vi.fn(async () => body) })

describe('searchTracks', () => {
  test('asks Spotify for tracks with the query and a limit of 10', async () => {
    const client = clientAnswering({ tracks: { items: [] } })
    await searchTracks(client, 'track:"sheesha" artist:"Karan Aujla"')
    expect(client.get).toHaveBeenCalledWith('/search', {
      query: { q: 'track:"sheesha" artist:"Karan Aujla"', type: 'track', limit: 10 },
    })
  })

  test('normalizes a result exactly as a playlist row is', async () => {
    const client = clientAnswering({ tracks: { items: [track('t1', 'Sheesha', 'Karan Aujla', 161000)] } })
    const [found] = await searchTracks(client, 'q')
    expect(found).toMatchObject({
      id: 't1',
      uri: 'spotify:track:t1',
      name: 'Sheesha',
      durationMs: 161000,
      isrc: 'GBKQU2290001',
      source: 'spotify',
      isUnavailable: false,
      originalIndex: 0,
    })
    expect(found.primaryArtist.name).toBe('Karan Aujla')
  })

  test('a null among the results is skipped, not read as an unavailable track', async () => {
    const client = clientAnswering({ tracks: { items: [null, track('t1', 'Sheesha', 'Karan Aujla', 161000)] } })
    expect((await searchTracks(client, 'q')).map((found) => [found.id, found.originalIndex])).toEqual([['t1', 0]])
  })

  test('an answer with no tracks is no results', async () => {
    expect(await searchTracks(clientAnswering({}), 'q')).toEqual([])
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/services/spotify/search.test.js`
Expected: FAIL, because `./search.js` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/services/spotify/search.js`:

```js
/**
 * Spotify catalogue search: the twin of an "Only on YouTube" song (Plan B).
 *
 * Read-only. Results are normalized exactly as playlist rows are, so the
 * matcher reads them without knowing where they came from. See
 * docs/2026-10-08-catalogue-search-design.md §4.
 */

import { normalizePlaylistItem } from '../../model/track.js'

/** Spotify's maximum for a development-mode app since February 2026. */
export const SEARCH_LIMIT = 10

/**
 * @param {{get: Function}} client the Spotify client (src/services/spotify/client.js)
 * @param {string} query Spotify search syntax, e.g. `track:"sheesha" artist:"Karan Aujla"`
 * @returns {Promise<Array<object>>} Tracks, numbered by result position
 */
export async function searchTracks(client, query, limit = SEARCH_LIMIT) {
  const body = await client.get('/search', { query: { q: query, type: 'track', limit } })
  // A null in the items would otherwise be read as an unavailable track.
  return (body?.tracks?.items ?? [])
    .filter(Boolean)
    .map((raw, index) => normalizePlaylistItem({ track: raw }, index))
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/services/spotify/search.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the whole suite and the lint**

Run: `npm test` and `npm run lint`.
Expected: 590 tests pass; the lint shows only the two existing warnings.

- [ ] **Step 6: Commit**

```bash
git add src/services/spotify/search.js src/services/spotify/search.test.js
git commit -m "Search the Spotify catalogue for tracks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Finding a twin

**Files:**
- Modify: `src/match/scorePair.js` (export `queryTitle`)
- Modify: `src/match/scorePair.test.js` (import; five cases)
- Modify: `src/match/pairTracks.js` (export `TIER_RANK`)
- Create: `src/match/findTwin.js`
- Test: `src/match/findTwin.test.js`

**Interfaces:**
- Consumes: `scorePair`, and the internal `essentialTitle`, `bylineNames`, `foldTitle` of `scorePair.js`; `TIER_RANK` from `pairTracks.js`; `normalizeYouTubeSearchResults` from Task 1 (tests only).
- Produces:
  - `queryTitle(youtubeTrack) → string`: the folded essential title to search for.
  - `TIER_RANK` (`{ certain: 3, strong: 2, likely: 1 }`), now exported.
  - `findOnYouTube(spotifyTrack, search, { skipIds }?) → Promise<{ candidates, nearMisses }>`, where `search(query, filter, limit)` resolves to normalized YouTube Tracks.
  - `findOnSpotify(youtubeTrack, search, { skipIds }?) → Promise<{ candidates, nearMisses }>`, where `search(query, limit)` resolves to normalized Spotify Tracks.
  - A candidate is `{ spotify, youtube, tier, durationDeltaMs, reason }`, best first (tier, then smaller drift, then search order). A near miss is a Track that `scorePair` refused, in search order. Both are deduped by id, and skip any id in `skipIds`.

- [ ] **Step 1: Write the failing tests**

In `src/match/scorePair.test.js`, add `queryTitle,` to the import list from `'./scorePair.js'` (after `VIDEO_MAX_DRIFT_MS,`), and append to the end of the file:

```js

describe('queryTitle', () => {
  // Titles verbatim from the live YouTube library and searches.
  test.each([
    ['Sheesha | Karan Aujla | J Statik | Sagar Deol | New Punjabi Song 2022', ['Karan Aujla'], 'sheesha'],
    ['Karan Aujla - Sheesha (Official Video)', ['Karan Aujla'], 'sheesha'],
    ['No Need (Full Video) Karan Aujla | Deep Jandu | Rupan Bal | Latest Punjabi song 2019', ['Rehaan Records'], 'no need'],
    ['AJA - Kaléra (Feat. Jaski)', ['Kaléra'], 'aja'],
    ['Hawawan', ['Chani Nattan', 'Gurinder Gill'], 'hawawan'],
  ])('%s searches as %s', (name, artists, expected) => {
    expect(queryTitle(video({ name, ...credits(...artists) }))).toBe(expected)
  })
})
```

(`video` and `credits` are helpers already defined in that file.)

Create `src/match/findTwin.test.js`:

```js
import { describe, expect, test, vi } from 'vitest'
import { normalizeYouTubeSearchResults } from '../services/youtube/track.js'
import { findOnSpotify, findOnYouTube } from './findTwin.js'

// A Spotify track as the app normalizes it. Values below are verbatim from the
// live Punjabi Songs export.
const spotify = (id, name, artists, durationMs, isrc, album) => ({
  id,
  uri: id ? `spotify:track:${id}` : null,
  name,
  durationMs,
  isrc,
  isLocal: false,
  videoType: null,
  album: { id: null, name: album },
  artists: artists.map((artist) => ({ id: artist, name: artist })),
  primaryArtist: { id: artists[0], name: artists[0] },
})

// A ytmusicapi search result. Values below are verbatim from live searches on
// 2026-10-08.
const result = (videoId, title, artists, seconds, videoType, album = null) => ({
  videoId,
  title,
  artists: artists.map((name) => ({ name, id: null })),
  album: album && { name: album, id: null },
  duration_seconds: seconds,
  videoType,
})

/** A YouTube search answering from a table keyed `filter:query`, recording every call. */
const youtubeSearch = (table) =>
  vi.fn(async (query, filter) => normalizeYouTubeSearchResults(table[`${filter}:${query}`] ?? []))

const ATV = 'MUSIC_VIDEO_TYPE_ATV'
const OMV = 'MUSIC_VIDEO_TYPE_OMV'

describe('findOnYouTube', () => {
  const taal = spotify(
    '7fnd0BMPbWuMsn6lBrshZL',
    'Taal Se Taal - Remix',
    ['Alka Yagnik', 'Udit Narayan', 'Farooq Got Audio'],
    164848,
    'INT102400308',
    'Taal Se Taal (Remix)',
  )
  const taalHit = result(
    '5L3qPLhFrZE',
    'Taal Se Taal (Remix)',
    ['Alka Yagnik ', 'Udit Narayan'],
    165,
    ATV,
    'Taal Se Taal (Remix)',
  )

  test('an ISRC hit that scores strong ends the search', async () => {
    const search = youtubeSearch({ 'songs:INT102400308': [taalHit] })
    const { candidates } = await findOnYouTube(taal, search)
    expect(candidates.map((pair) => [pair.youtube.id, pair.tier])).toEqual([['5L3qPLhFrZE', 'strong']])
    expect(search.mock.calls).toEqual([['INT102400308', 'songs', 3]])
  })

  test('an ISRC that finds an unrelated song falls through to title and artist', async () => {
    const brown = spotify(
      '2w8OTd8nwVEcDA60S4Ws92',
      'BROWN BROWN RANG',
      ['Chani Nattan', 'Inderpal Moga', 'Karam Brar', 'G-Funk'],
      176818,
      'US38Y2507058',
      'NICE DAY IN THE PIND',
    )
    const search = youtubeSearch({
      'songs:US38Y2507058': [result('u1n1E3PMm0A', 'انا 5 استار على كوكبى', ['Hamo El Morshedy'], 279, OMV)],
      'songs:BROWN BROWN RANG Chani Nattan': [
        result(
          '26Ec977sp8A',
          'BROWN BROWN RANG',
          ['Chani Nattan', 'Inderpal Moga', 'Karam Brar', 'G-Funk'],
          177,
          ATV,
          'NICE DAY IN THE PIND',
        ),
      ],
    })
    const { candidates, nearMisses } = await findOnYouTube(brown, search)
    expect(candidates.map((pair) => [pair.youtube.id, pair.tier])).toEqual([['26Ec977sp8A', 'strong']])
    expect(nearMisses.map((track) => track.id)).toEqual(['u1n1E3PMm0A'])
    expect(search).toHaveBeenCalledTimes(2)
  })

  test('a song YouTube has only as a video is found among videos', async () => {
    const aja = spotify('54GK1bZMOAMXKysrnH4vTp', 'AJA', ['Kaléra', 'Jaski'], 134400, 'QZTBC2394855', 'AJA')
    const search = youtubeSearch({
      'songs:QZTBC2394855': [result('0iVlSNpq8i8', 'BIRDBRAIN (feat. OK Glass)', ['Jamie Paige'], 256, OMV)],
      'songs:AJA Kaléra': [result('3pW4PrhFiLc', 'Aaja', ['Nucleya'], 272, ATV, 'Bass Rani')],
      'videos:AJA Kaléra': [result('q7e348rz27I', 'AJA - Kaléra (Feat. Jaski)', ['Kaléra'], 136, OMV)],
    })
    const { candidates } = await findOnYouTube(aja, search)
    expect(candidates.map((pair) => [pair.youtube.id, pair.tier])).toEqual([['q7e348rz27I', 'strong']])
    expect(search.mock.calls.at(-1)).toEqual(['AJA Kaléra', 'videos', 3])
  })

  test('a mix-name variant is a near miss, offered once however often it is found', async () => {
    const parda = spotify(
      '4kCOXEXuJGmtL1Fze6WoEH',
      'Parda Hata Do - Farooq Got Audio Mix',
      ['Asha Bhosle', 'Mohammed Rafi', 'Farooq Got Audio'],
      182399,
      'INH102207809',
      'Bollywood Trap Mix',
    )
    const trapMix = result(
      '99mFO0XaoLQ',
      'Parda Hata Do - Trap Mix',
      ['Farooq Got Audio', 'Asha Bhosle', 'Mohammed Rafi'],
      183,
      ATV,
      'Bollywood Trap Mix',
    )
    const search = youtubeSearch({
      'songs:INH102207809': [trapMix],
      'songs:Parda Hata Do - Farooq Got Audio Mix Asha Bhosle': [trapMix],
    })
    const { candidates, nearMisses } = await findOnYouTube(parda, search)
    expect(candidates).toEqual([])
    expect(nearMisses.map((track) => track.id)).toEqual(['99mFO0XaoLQ'])
  })

  test('a result already in the YouTube playlist is skipped', async () => {
    const search = youtubeSearch({ 'songs:INT102400308': [taalHit] })
    const found = await findOnYouTube(taal, search, { skipIds: new Set(['5L3qPLhFrZE']) })
    expect(found).toEqual({ candidates: [], nearMisses: [] })
    expect(search).toHaveBeenCalledTimes(3)
  })

  test('a local file, which has no ISRC, starts with title and artist', async () => {
    const local = {
      ...spotify(null, 'Haye Mera Dil', ['Alfaaz; Yo Yo Honey Singh'], 203000, null, 'Boy Next Door'),
      uri: 'spotify:local:Alfaaz%3B+Yo+Yo+Honey+Singh:Boy+Next+Door:Haye+Mera+Dil:203',
      isLocal: true,
    }
    const search = youtubeSearch({})
    await findOnYouTube(local, search)
    expect(search.mock.calls[0]).toEqual(['Haye Mera Dil Alfaaz; Yo Yo Honey Singh', 'songs', 5])
  })
})

describe('findOnSpotify', () => {
  const sheeshaVideo = normalizeYouTubeSearchResults([
    result('sheeshaOMV', 'Sheesha | Karan Aujla | J Statik | Sagar Deol | New Punjabi Song 2022', ['Karan Aujla'], 176, OMV),
  ])[0]

  test('searches for the title read past its decoration, with the primary artist', async () => {
    const search = vi.fn(async () => [spotify('s1', 'Sheesha', ['Karan Aujla'], 161000, null, 'Sheesha')])
    const { candidates } = await findOnSpotify(sheeshaVideo, search)
    expect(search.mock.calls).toEqual([
      ['track:"sheesha" artist:"Karan Aujla"', 10],
      ['sheesha Karan Aujla', 10],
    ])
    // A video 15s longer than the audio is likely, never strong, so both steps run.
    expect(candidates.map((pair) => [pair.spotify.id, pair.tier])).toEqual([['s1', 'likely']])
  })

  test('a double quote in an artist name cannot break the field syntax', async () => {
    const quoted = { ...sheeshaVideo, primaryArtist: { id: null, name: 'DJ "Snake"' } }
    const search = vi.fn(async () => [])
    await findOnSpotify(quoted, search)
    expect(search.mock.calls[0][0]).toBe('track:"sheesha" artist:"DJ Snake"')
  })

  test('a video with no artist searches by title alone', async () => {
    const uncredited = { ...sheeshaVideo, artists: [], primaryArtist: null }
    const search = vi.fn(async () => [])
    await findOnSpotify(uncredited, search)
    expect(search.mock.calls).toEqual([
      ['track:"sheesha"', 10],
      ['sheesha', 10],
    ])
  })

  test('a result already in the Spotify playlist is skipped', async () => {
    const search = vi.fn(async () => [spotify('s1', 'Sheesha', ['Karan Aujla'], 161000, null, 'Sheesha')])
    expect(await findOnSpotify(sheeshaVideo, search, { skipIds: new Set(['s1']) })).toEqual({
      candidates: [],
      nearMisses: [],
    })
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/match/findTwin.test.js src/match/scorePair.test.js`
Expected: FAIL. `./findTwin.js` does not exist, and `queryTitle is not a function`.

- [ ] **Step 3: Export `queryTitle` and `TIER_RANK`**

In `src/match/scorePair.js`, insert this directly above the JSDoc comment that begins `A title's lead and tail segments, read past a leading artist credit` (the comment above `function splitTitle`):

```js
/**
 * What to search another catalogue for, given a YouTube track: its title read
 * past decoration and a leading artist credit, as scorePair itself reads it —
 * `Sheesha | Karan Aujla | … | New Punjabi Song 2022` searches as `sheesha`.
 * The whole folded title when nothing is left. Catalogue search design §4.
 */
export function queryTitle(track) {
  return essentialTitle(track?.name, new Set(bylineNames(track))) || foldTitle(track?.name)
}

```

Change nothing else in `scorePair.js`.

In `src/match/pairTracks.js`, change the line `const TIER_RANK = { certain: 3, strong: 2, likely: 1 }` to:

```js
/** How sure each tier is; settling claims the surest pair first. */
export const TIER_RANK = { certain: 3, strong: 2, likely: 1 }
```

- [ ] **Step 4: Write `findTwin.js`**

Create `src/match/findTwin.js`:

```js
/**
 * Finding a song's twin in the other service's catalogue (Plan B).
 *
 * Pure apart from the search function it is handed, so it is tested with
 * recorded results and no network. Every result is judged by scorePair, the
 * audited matcher, and nothing here confirms anything: an accepted result is
 * a proposal, a refused one a near miss for Pair with… (D28). See
 * docs/2026-10-08-catalogue-search-design.md §4.
 */

import { TIER_RANK } from './pairTracks.js'
import { queryTitle, scorePair } from './scorePair.js'

/**
 * A Spotify song's twin on YouTube Music: its ISRC first (D30), then title
 * and artist among songs, then among videos. Stops at the first step that
 * finds a strong match.
 *
 * @param {object} spotifyTrack
 * @param {(query: string, filter: 'songs'|'videos', limit: number) => Promise<Array>} search
 *   resolves to normalized YouTube Tracks
 * @param {{skipIds?: Set<string>}} [options] video ids already in the YouTube playlist
 * @returns {Promise<{candidates: Array, nearMisses: Array}>}
 */
export function findOnYouTube(spotifyTrack, search, { skipIds } = {}) {
  const text = `${spotifyTrack?.name ?? ''} ${spotifyTrack?.primaryArtist?.name ?? ''}`.trim()
  const steps = [
    spotifyTrack?.isrc ? () => search(spotifyTrack.isrc, 'songs', 3) : null,
    () => search(text, 'songs', 5),
    () => search(text, 'videos', 3),
  ].filter(Boolean)
  return runCascade(steps, skipIds, (youtube) => {
    const scored = scorePair(spotifyTrack, youtube)
    return scored && { spotify: spotifyTrack, youtube, ...scored }
  })
}

/**
 * A YouTube song's twin on Spotify: field search on its title and primary
 * artist, then a plain search. YouTube has no ISRC. The title is read past
 * YouTube's decoration first (queryTitle).
 *
 * @param {object} youtubeTrack
 * @param {(query: string, limit: number) => Promise<Array>} search resolves to normalized Spotify Tracks
 * @param {{skipIds?: Set<string>}} [options] Spotify ids already in the Spotify playlist
 * @returns {Promise<{candidates: Array, nearMisses: Array}>}
 */
export function findOnSpotify(youtubeTrack, search, { skipIds } = {}) {
  const title = unquote(queryTitle(youtubeTrack))
  const artist = unquote(youtubeTrack?.primaryArtist?.name ?? '')
  const fielded = artist ? `track:"${title}" artist:"${artist}"` : `track:"${title}"`
  const steps = [() => search(fielded, 10), () => search(`${title} ${artist}`.trim(), 10)]
  return runCascade(steps, skipIds, (spotify) => {
    const scored = scorePair(spotify, youtubeTrack)
    return scored && { spotify, youtube: youtubeTrack, ...scored }
  })
}

async function runCascade(steps, skipIds = new Set(), judge) {
  const seen = new Set()
  const candidates = []
  const nearMisses = []
  for (const step of steps) {
    for (const track of await step()) {
      // The playlist pairing has already judged a track in the playlist.
      if (!track?.id || seen.has(track.id) || skipIds.has(track.id)) continue
      seen.add(track.id)
      const pair = judge(track)
      if (pair) candidates.push(pair)
      else nearMisses.push(track)
    }
    if (candidates.some((pair) => pair.tier === 'strong')) break
  }
  // Stable, so an equal tier and drift keeps search order: an ISRC hit stays first.
  candidates.sort(
    (a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || Math.abs(a.durationDeltaMs) - Math.abs(b.durationDeltaMs),
  )
  return { candidates, nearMisses }
}

/** Spotify's field syntax quotes a value, so a stray double quote would end it early. */
function unquote(text) {
  return String(text).replaceAll('"', ' ').replace(/\s+/g, ' ').trim()
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/match`
Expected: PASS: every existing test in `src/match`, the 5 `queryTitle` cases and the 10 `findTwin` tests.

- [ ] **Step 6: The real-library gate**

The spec requires the search cascade, replayed over the recorded YouTube Music results for the 111 real "Only on Spotify" songs, to reproduce the probe's counts exactly. The recording is in this session's scratchpad. Run from the repo root in Git Bash:

```bash
R="C:/Users/Soans/AppData/Local/Temp/claude/c--Users-Soans-Desktop-Work-spotify-playlist-sorter/9fb3a0da-2013-4fe6-aa6e-cec1bbca027e/scratchpad/search-probe-out.json"
node --input-type=module -e "
import { readFileSync } from 'node:fs'
const { findOnYouTube } = await import('./src/match/findTwin.js')
const { normalizeYouTubeSearchResults } = await import('./src/services/youtube/track.js')
const rows = JSON.parse(readFileSync('$R', 'utf8'))
const tally = { strong: 0, likely: 0, none: 0 }
let searches = 0
for (const row of rows) {
  const s = row.spotify
  const search = async (query, filter) => {
    searches += 1
    return normalizeYouTubeSearchResults(query === s.isrc ? row.isrc : filter === 'songs' ? row.songs : row.videos)
  }
  const { candidates } = await findOnYouTube(s, search)
  tally[candidates[0]?.tier ?? 'none'] += 1
}
console.log(JSON.stringify(tally), 'searches', searches)
"
```

Expected: `{"strong":88,"likely":4,"none":19} searches 165`. If the counts differ, stop and report. Do not adjust anything to make them match.

- [ ] **Step 7: Run the whole suite and the lint**

Run: `npm test` and `npm run lint`.
Expected: 605 tests pass; the lint shows only the two existing warnings.

- [ ] **Step 8: Commit**

```bash
git add src/match/scorePair.js src/match/scorePair.test.js src/match/pairTracks.js src/match/findTwin.js src/match/findTwin.test.js
git commit -m "Find a song's twin in the other catalogue, ISRC first

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Remembering and settling finds

**Files:**
- Modify: `src/match/matchBook.js` (a `found` snapshot on a decision; `snapshotOf`, `trackFromSnapshot`; validation on load)
- Modify: `src/match/matchBook.test.js` (import; five tests)
- Create: `src/match/settleFound.js`
- Test: `src/match/settleFound.test.js`

**Interfaces:**
- Consumes: `TIER_RANK` from Task 3; `spotifyKeyOf`, `verdictLookup`, `recordDecision` from the existing match book.
- Produces:
  - `recordDecision(book, { spotifyKey, youtubeVideoId, verdict, found? }, decidedAt?)`: stores `found` only when given.
  - `snapshotOf(track, side) → { side, name, artists: string[], durationMs, videoType, uri }`, where `side` is `'youtube'` or `'spotify'`.
  - `trackFromSnapshot(decision) → Track`: `id` is the decision's `youtubeVideoId` for a YouTube snapshot and its `spotifyKey` for a Spotify one.
  - `loadMatchBook` keeps a decision whose `found` is not a snapshot, without the `found`.
  - `settleFound(settled, { spotifyTracks, youtubeTracks, book, foundForSpotify?, foundForYoutube? })` returns the shape `settlePairs` returns, and a found pair also carries `missingFrom: 'youtube' | 'spotify'`. `foundForSpotify` is a `Map` keyed by `spotifyKeyOf`; `foundForYoutube` a `Map` keyed by video id. Each value is what `findOnYouTube` or `findOnSpotify` returned.

- [ ] **Step 1: Write the failing match book tests**

In `src/match/matchBook.test.js`, add `snapshotOf,` and `trackFromSnapshot,` to the import list from `'./matchBook.js'`, keeping it alphabetical (the list becomes `forgetDecision, loadMatchBook, recordDecision, saveMatchBook, snapshotOf, spotifyKeyOf, trackFromSnapshot, verdictLookup`). Then append to the end of the file (`memoryStorage` and `same` are helpers already defined at the top):

```js

describe('a confirmed find', () => {
  // Verbatim from a live YouTube Music search: AJA is on YouTube only as a video.
  const ajaVideo = {
    id: 'q7e348rz27I',
    uri: null,
    name: 'AJA - Kaléra (Feat. Jaski)',
    artists: [{ id: null, name: 'Kaléra' }],
    durationMs: 136000,
    videoType: 'MUSIC_VIDEO_TYPE_OMV',
  }
  const confirmed = (found) =>
    recordDecision([], { spotifyKey: '54GK1bZMOAMXKysrnH4vTp', youtubeVideoId: 'q7e348rz27I', verdict: 'same', found }, 1)

  test('keeps its snapshot through a save and a load', () => {
    const storage = memoryStorage()
    const book = confirmed(snapshotOf(ajaVideo, 'youtube'))
    saveMatchBook(book, storage)
    expect(loadMatchBook(storage)).toEqual(book)
    expect(book[0].found).toEqual({
      side: 'youtube',
      name: 'AJA - Kaléra (Feat. Jaski)',
      artists: ['Kaléra'],
      durationMs: 136000,
      videoType: 'MUSIC_VIDEO_TYPE_OMV',
      uri: null,
    })
  })

  test('a decision with no find has no snapshot key at all', () => {
    expect(Object.keys(recordDecision([], same('s1', 'y1'), 1)[0])).toEqual([
      'spotifyKey',
      'youtubeVideoId',
      'verdict',
      'decidedAt',
    ])
  })

  test('a snapshot that is not one is dropped on load, and the decision kept', () => {
    const storage = memoryStorage()
    storage.setItem(
      'playlist-sorter:match-book',
      JSON.stringify([{ spotifyKey: 's1', youtubeVideoId: 'y1', verdict: 'same', decidedAt: 1, found: 'garbage' }]),
    )
    expect(loadMatchBook(storage)).toEqual([{ spotifyKey: 's1', youtubeVideoId: 'y1', verdict: 'same', decidedAt: 1 }])
  })

  test('rebuilds the found YouTube track from its snapshot', () => {
    const [decision] = confirmed(snapshotOf(ajaVideo, 'youtube'))
    expect(trackFromSnapshot(decision)).toMatchObject({
      id: 'q7e348rz27I',
      name: 'AJA - Kaléra (Feat. Jaski)',
      primaryArtist: { id: null, name: 'Kaléra' },
      durationMs: 136000,
      videoType: 'MUSIC_VIDEO_TYPE_OMV',
      source: 'youtube',
    })
  })

  test('rebuilds a found Spotify track under its Spotify id, with its URI', () => {
    const sheesha = {
      id: '1MGHB7pXahNVdHxKPbMvdx',
      uri: 'spotify:track:1MGHB7pXahNVdHxKPbMvdx',
      name: 'Sheesha',
      artists: [{ id: 'x', name: 'Karan Aujla' }],
      durationMs: 161000,
      videoType: null,
    }
    const [decision] = recordDecision(
      [],
      { spotifyKey: sheesha.id, youtubeVideoId: 'sheeshaOMV', verdict: 'same', found: snapshotOf(sheesha, 'spotify') },
      1,
    )
    expect(trackFromSnapshot(decision)).toMatchObject({
      id: '1MGHB7pXahNVdHxKPbMvdx',
      uri: 'spotify:track:1MGHB7pXahNVdHxKPbMvdx',
      name: 'Sheesha',
      source: 'spotify',
    })
  })
})
```

- [ ] **Step 2: Write the failing settling tests**

Create `src/match/settleFound.test.js`:

```js
import { describe, expect, test } from 'vitest'
import { recordDecision, snapshotOf } from './matchBook.js'
import { settleFound } from './settleFound.js'

const sp = (id, name, durationMs) => ({
  id,
  uri: `spotify:track:${id}`,
  name,
  durationMs,
  artists: [{ id: 'a', name: 'Karan Aujla' }],
  primaryArtist: { id: 'a', name: 'Karan Aujla' },
})
const yt = (id, name, durationMs, videoType = 'MUSIC_VIDEO_TYPE_ATV') => ({
  id,
  uri: null,
  name,
  durationMs,
  videoType,
  artists: [{ id: null, name: 'Karan Aujla' }],
  primaryArtist: { id: null, name: 'Karan Aujla' },
})
const found = (spotify, youtube, tier, durationDeltaMs = 0) => ({
  spotify,
  youtube,
  tier,
  durationDeltaMs,
  reason: 'found',
})
/** What settlePairs returns when the two playlists pair nothing. */
const nothingPaired = (spotifyTracks, youtubeTracks) => ({
  pairs: [],
  unmatchedSpotify: spotifyTracks,
  unmatchedYoutube: youtubeTracks,
})
const summary = (result) => result.pairs.map((pair) => [pair.spotify.id, pair.youtube.id, pair.tier, pair.missingFrom])

describe('settleFound', () => {
  const song = sp('s1', 'Antidote', 188000)
  const y1 = yt('y1', 'Antidote', 188000)
  const y2 = yt('y2', 'Antidote', 191000)

  test('an unmatched Spotify song takes its best find, marked missing from YouTube', () => {
    const result = settleFound(nothingPaired([song], []), {
      spotifyTracks: [song],
      youtubeTracks: [],
      book: [],
      foundForSpotify: new Map([['s1', { candidates: [found(song, y1, 'strong'), found(song, y2, 'likely', 3000)] }]]),
    })
    expect(summary(result)).toEqual([['s1', 'y1', 'strong', 'youtube']])
    expect(result.unmatchedSpotify).toEqual([])
  })

  test('rejecting the best find moves the song to its next one', () => {
    const book = recordDecision([], { spotifyKey: 's1', youtubeVideoId: 'y1', verdict: 'different' }, 1)
    const result = settleFound(nothingPaired([song], []), {
      spotifyTracks: [song],
      youtubeTracks: [],
      book,
      foundForSpotify: new Map([['s1', { candidates: [found(song, y1, 'strong'), found(song, y2, 'likely', 3000)] }]]),
    })
    expect(summary(result)).toEqual([['s1', 'y2', 'likely', 'youtube']])
  })

  test('rejecting every find leaves the song unmatched', () => {
    const book = recordDecision([], { spotifyKey: 's1', youtubeVideoId: 'y1', verdict: 'different' }, 1)
    const result = settleFound(nothingPaired([song], []), {
      spotifyTracks: [song],
      youtubeTracks: [],
      book,
      foundForSpotify: new Map([['s1', { candidates: [found(song, y1, 'strong')] }]]),
    })
    expect(result.pairs).toEqual([])
    expect(result.unmatchedSpotify).toEqual([song])
  })

  test('an unmatched YouTube song takes its best Spotify find, marked missing from Spotify', () => {
    const video = yt('v1', 'Sheesha | Karan Aujla | New Punjabi Song 2022', 176000, 'MUSIC_VIDEO_TYPE_OMV')
    const twin = sp('t1', 'Sheesha', 161000)
    const result = settleFound(nothingPaired([], [video]), {
      spotifyTracks: [],
      youtubeTracks: [video],
      book: [],
      foundForYoutube: new Map([['v1', { candidates: [found(twin, video, 'likely', 15000)] }]]),
    })
    expect(summary(result)).toEqual([['t1', 'v1', 'likely', 'spotify']])
    expect(result.unmatchedYoutube).toEqual([])
  })

  test('a confirmed find is certain after a reload, rebuilt from its snapshot with no search', () => {
    const aja = sp('54GK1bZMOAMXKysrnH4vTp', 'AJA', 134400)
    const ajaVideo = yt('q7e348rz27I', 'AJA - Kaléra (Feat. Jaski)', 136000, 'MUSIC_VIDEO_TYPE_OMV')
    const book = recordDecision(
      [],
      { spotifyKey: aja.id, youtubeVideoId: ajaVideo.id, verdict: 'same', found: snapshotOf(ajaVideo, 'youtube') },
      1,
    )
    const result = settleFound(nothingPaired([aja], []), { spotifyTracks: [aja], youtubeTracks: [], book })
    expect(summary(result)).toEqual([[aja.id, 'q7e348rz27I', 'certain', 'youtube']])
    expect(result.pairs[0].youtube.name).toBe('AJA - Kaléra (Feat. Jaski)')
    expect(result.pairs[0].durationDeltaMs).toBe(1600)
  })

  test('a confirmed Spotify find is certain for its YouTube song', () => {
    const video = yt('v1', 'Sheesha | Karan Aujla | New Punjabi Song 2022', 176000, 'MUSIC_VIDEO_TYPE_OMV')
    const twin = sp('t1', 'Sheesha', 161000)
    const book = recordDecision(
      [],
      { spotifyKey: 't1', youtubeVideoId: 'v1', verdict: 'same', found: snapshotOf(twin, 'spotify') },
      1,
    )
    const result = settleFound(nothingPaired([], [video]), { spotifyTracks: [], youtubeTracks: [video], book })
    expect(summary(result)).toEqual([['t1', 'v1', 'certain', 'spotify']])
    expect(result.pairs[0].spotify.uri).toBe('spotify:track:t1')
  })

  test('a snapshot is ignored once its track is in the YouTube playlist', () => {
    const book = recordDecision(
      [],
      { spotifyKey: 's1', youtubeVideoId: 'y1', verdict: 'same', found: snapshotOf(y1, 'youtube') },
      1,
    )
    // y1 is in the playlist, so settlePairs owns the pair; here s1 is left
    // over only because something else claimed y1.
    const result = settleFound(nothingPaired([song], []), { spotifyTracks: [song], youtubeTracks: [y1], book })
    expect(result.pairs).toEqual([])
  })

  test('the same Spotify song listed twice claims one find once', () => {
    const again = sp('s1', 'Antidote', 188000)
    const result = settleFound(nothingPaired([song, again], []), {
      spotifyTracks: [song, again],
      youtubeTracks: [],
      book: [],
      foundForSpotify: new Map([['s1', { candidates: [found(song, y1, 'strong')] }]]),
    })
    expect(result.pairs).toHaveLength(1)
    expect(result.unmatchedSpotify).toHaveLength(1)
  })

  test('two songs wanting one found track: the surer claim takes it', () => {
    const other = sp('s2', 'Antidote', 191000)
    // Two searches return the same video as two different objects.
    const result = settleFound(nothingPaired([other, song], []), {
      spotifyTracks: [other, song],
      youtubeTracks: [],
      book: [],
      foundForSpotify: new Map([
        ['s2', { candidates: [found(other, { ...y1 }, 'likely', 3000)] }],
        ['s1', { candidates: [found(song, { ...y1 }, 'strong')] }],
      ]),
    })
    expect(summary(result)).toEqual([['s1', 'y1', 'strong', 'youtube']])
    expect(result.unmatchedSpotify.map((track) => track.id)).toEqual(['s2'])
  })

  test('pairs from the two playlists pass through untouched', () => {
    const playlistPair = found(song, y1, 'strong')
    const result = settleFound(
      { pairs: [playlistPair], unmatchedSpotify: [], unmatchedYoutube: [] },
      { spotifyTracks: [song], youtubeTracks: [y1], book: [] },
    )
    expect(result.pairs).toEqual([playlistPair])
    expect(result.pairs[0]).toBe(playlistPair)
  })
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run src/match/matchBook.test.js src/match/settleFound.test.js`
Expected: FAIL. `snapshotOf is not a function`, and `./settleFound.js` does not exist.

- [ ] **Step 4: Extend the match book**

In `src/match/matchBook.js`:

(a) In `loadMatchBook`, change `return Array.isArray(parsed) ? parsed.filter(isDecision) : []` to:

```js
    return Array.isArray(parsed) ? parsed.filter(isDecision).map(withValidFind) : []
```

(b) Replace the whole `recordDecision` function, with its one-line JSDoc, by:

```js
/**
 * The book with this pair's decision set, replacing any earlier one. A
 * confirmed find carries a snapshot of the found track (D29).
 */
export function recordDecision(book, { spotifyKey, youtubeVideoId, verdict, found }, decidedAt = Date.now()) {
  const entry = { spotifyKey, youtubeVideoId, verdict, decidedAt }
  if (found) entry.found = found
  return [...forgetDecision(book, spotifyKey, youtubeVideoId), entry]
}

/**
 * What a confirmed find keeps of the found track. The track is in neither
 * playlist, so after a reload nothing else knows it (catalogue search design
 * §7). `uri` is what a Plan C add to Spotify needs.
 *
 * @param {object} track
 * @param {'youtube'|'spotify'} side which service the track is from
 */
export function snapshotOf(track, side) {
  return {
    side,
    name: track?.name ?? '',
    artists: (track?.artists ?? []).map((artist) => artist?.name ?? ''),
    durationMs: track?.durationMs ?? 0,
    videoType: track?.videoType ?? null,
    uri: track?.uri ?? null,
  }
}

/** The found track a decision's snapshot describes, in the app's Track shape. */
export function trackFromSnapshot(decision) {
  const { found } = decision
  const artists = found.artists.map((name) => ({ id: null, name }))
  return {
    id: found.side === 'youtube' ? decision.youtubeVideoId : decision.spotifyKey,
    uri: found.uri,
    name: found.name,
    artists,
    primaryArtist: artists[0] ?? null,
    album: { id: null, name: '', releaseDate: null, releaseDatePrecision: null },
    durationMs: found.durationMs,
    videoType: found.videoType,
    source: found.side,
    isLocal: false,
    isUnavailable: false,
    isEpisode: false,
  }
}
```

(c) Append to the end of the file:

```js

/** A decision whose `found` is not a snapshot keeps the decision and loses the `found`. */
function withValidFind(entry) {
  if (entry.found === undefined || isSnapshot(entry.found)) return entry
  const kept = { ...entry }
  delete kept.found
  return kept
}

function isSnapshot(found) {
  return (
    (found?.side === 'youtube' || found?.side === 'spotify') &&
    typeof found.name === 'string' &&
    Array.isArray(found.artists) &&
    Number.isFinite(found.durationMs)
  )
}
```

- [ ] **Step 5: Write `settleFound.js`**

Create `src/match/settleFound.js`:

```js
/**
 * Settling what catalogue search found (Plan B), after the two playlists have
 * been paired.
 *
 * Pure. It runs on settlePairs' leftovers only, so playlist pairing never
 * changes: each unmatched song takes its best found twin that the user has
 * not rejected, and a confirmed find — rebuilt from its match-book snapshot,
 * with no search — is certain. See docs/2026-10-08-catalogue-search-design.md §5.
 */

import { spotifyKeyOf, trackFromSnapshot, verdictLookup } from './matchBook.js'
import { TIER_RANK } from './pairTracks.js'

/**
 * @param {{pairs: Array, unmatchedSpotify: Array, unmatchedYoutube: Array}} settled what settlePairs returned
 * @param {object} context
 * @param {Array} context.spotifyTracks the Spotify playlist
 * @param {Array} context.youtubeTracks the YouTube playlist
 * @param {Array} context.book the match book
 * @param {Map<string, {candidates: Array}>} [context.foundForSpotify] YouTube twins, by spotifyKeyOf
 * @param {Map<string, {candidates: Array}>} [context.foundForYoutube] Spotify twins, by video id
 * @returns the shape settlePairs returns; a pair with a found track also carries
 *   `missingFrom: 'youtube' | 'spotify'`, the playlist that lacks it
 */
export function settleFound(
  settled,
  { spotifyTracks, youtubeTracks, book, foundForSpotify = new Map(), foundForYoutube = new Map() },
) {
  const verdictFor = verdictLookup(book)
  const inSpotify = new Set(spotifyTracks.map(spotifyKeyOf))
  const inYoutube = new Set(youtubeTracks.map((track) => track.id))
  const confirmedFinds = book.filter((entry) => entry.verdict === 'same' && entry.found)

  const claims = []
  for (const song of settled.unmatchedSpotify) {
    const key = spotifyKeyOf(song)
    for (const entry of confirmedFinds) {
      // Once the found track is in the YouTube playlist, settlePairs owns the pair.
      if (entry.found.side !== 'youtube' || entry.spotifyKey !== key || inYoutube.has(entry.youtubeVideoId)) continue
      claims.push(certain(song, trackFromSnapshot(entry), 'youtube'))
    }
    for (const candidate of foundForSpotify.get(key)?.candidates ?? []) {
      // 'same' is already a certain claim above; 'different' is rejected for good.
      if (verdictFor(key, candidate.youtube.id) !== null) continue
      claims.push({ ...candidate, spotify: song, missingFrom: 'youtube' })
    }
  }
  for (const song of settled.unmatchedYoutube) {
    for (const entry of confirmedFinds) {
      if (entry.found.side !== 'spotify' || entry.youtubeVideoId !== song.id || inSpotify.has(entry.spotifyKey)) continue
      claims.push(certain(trackFromSnapshot(entry), song, 'spotify'))
    }
    for (const candidate of foundForYoutube.get(song.id)?.candidates ?? []) {
      if (verdictFor(spotifyKeyOf(candidate.spotify), song.id) !== null) continue
      claims.push({ ...candidate, youtube: song, missingFrom: 'spotify' })
    }
  }

  // The surest claim first, as settlePairs orders them. Stable, so ties keep
  // search order.
  claims.sort(
    (a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || Math.abs(a.durationDeltaMs) - Math.abs(b.durationDeltaMs),
  )

  const found = []
  const claimedSongs = new Set()
  const claimedFinds = new Set()
  for (const claim of claims) {
    const song = claim.missingFrom === 'youtube' ? claim.spotify : claim.youtube
    // Two searches can return the same track as different objects, so a find
    // is claimed by id, not identity.
    const find = claim.missingFrom === 'youtube' ? `y:${claim.youtube.id}` : `s:${spotifyKeyOf(claim.spotify)}`
    if (claimedSongs.has(song) || claimedFinds.has(find)) continue
    claimedSongs.add(song)
    claimedFinds.add(find)
    found.push(claim)
  }

  const pairs = [...settled.pairs, ...found]
  const unmatchedSpotify = settled.unmatchedSpotify.filter((track) => !claimedSongs.has(track))
  const unmatchedYoutube = settled.unmatchedYoutube.filter((track) => !claimedSongs.has(track))
  return {
    pairs,
    unmatchedSpotify,
    unmatchedYoutube,
    counts: {
      certain: pairs.filter((pair) => pair.tier === 'certain').length,
      strong: pairs.filter((pair) => pair.tier === 'strong').length,
      likely: pairs.filter((pair) => pair.tier === 'likely').length,
      unmatchedSpotify: unmatchedSpotify.length,
      unmatchedYoutube: unmatchedYoutube.length,
    },
  }
}

function certain(spotify, youtube, missingFrom) {
  return {
    spotify,
    youtube,
    missingFrom,
    tier: 'certain',
    durationDeltaMs: (youtube?.durationMs ?? 0) - (spotify?.durationMs ?? 0),
    reason: 'You confirmed this find before',
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/match`
Expected: PASS, every test in `src/match`, including the 5 new match book tests and the 10 `settleFound` tests.

- [ ] **Step 7: Run the whole suite and the lint**

Run: `npm test` and `npm run lint`.
Expected: 620 tests pass; the lint shows only the two existing warnings.

- [ ] **Step 8: Commit**

```bash
git add src/match/matchBook.js src/match/matchBook.test.js src/match/settleFound.js src/match/settleFound.test.js
git commit -m "Remember a confirmed find, and settle finds on the leftovers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The sweep and the board

**Files:**
- Create: `src/ui/sweep.js`
- Test: `src/ui/sweep.test.js`
- Modify: `src/ui/useMatchReview.js` (rewritten in full below)
- Modify: `src/ui/screens/Review.jsx` (rewritten in full below)
- Modify: `src/ui/useSorterApp.js` (add `client,` to the returned object)
- Modify: `src/ui/board.css` (the review board's row height)

**Interfaces:**
- Consumes: Task 1 (`youtube.search`, `normalizeYouTubeSearchResults`), Task 2 (`searchTracks`), Task 3 (`findOnYouTube`, `findOnSpotify`), Task 4 (`snapshotOf`, `settleFound`); the existing `AuthError` (`src/services/spotify/client.js`), and `ProxyUnavailableError` and `YouTubeSessionExpiredError` (`src/services/youtube/client.js`).
- Produces:
  - `sweepHalf(songs, { find, live, onFound, onFailed, onStopped, isFatal }) → Promise<void>`.
  - `useMatchReview({ youtube, spotify, spotifyTracks, storage? })`: everything it returned before, plus `found` (`{ forSpotify: Map, forYoutube: Map }`), `sweep` (`{ done, total, failed, running, errors: [{ label, message }] } | null`), `unsearchedCount`, `searchAll()`, `stopSearch()`.
  - `app.client`: the Spotify client, now returned by `useSorterApp`.

There is no hook or component test infrastructure in this repo (spec §9), so `sweepHalf` carries the sweep's logic under unit test, and the screen is gated by Task 6's walkthrough.

- [ ] **Step 1: Write the failing sweep tests**

Create `src/ui/sweep.test.js`:

```js
import { describe, expect, test, vi } from 'vitest'
import { sweepHalf } from './sweep.js'

class Fatal extends Error {}

function handlers(over = {}) {
  return {
    find: vi.fn(async (song) => ({ candidates: [song], nearMisses: [] })),
    live: () => true,
    onFound: vi.fn(),
    onFailed: vi.fn(),
    onStopped: vi.fn(),
    isFatal: (failure) => failure instanceof Fatal,
    ...over,
  }
}

describe('sweepHalf', () => {
  test('searches every song in turn and reports each find', async () => {
    const h = handlers()
    await sweepHalf(['a', 'b'], h)
    expect(h.find.mock.calls).toEqual([['a'], ['b']])
    expect(h.onFound.mock.calls.map(([song]) => song)).toEqual(['a', 'b'])
  })

  test('once stopped, it searches nothing more and drops the result in flight', async () => {
    let live = true
    const h = handlers({
      live: () => live,
      find: vi.fn(async (song) => {
        live = false // Stop is pressed while this search is in flight.
        return { candidates: [song], nearMisses: [] }
      }),
    })
    await sweepHalf(['a', 'b'], h)
    expect(h.find).toHaveBeenCalledTimes(1)
    expect(h.onFound).not.toHaveBeenCalled()
  })

  test('a fatal failure ends the half and is reported once', async () => {
    const h = handlers({ find: vi.fn(async () => Promise.reject(new Fatal('The YouTube proxy is not running.'))) })
    await sweepHalf(['a', 'b'], h)
    expect(h.find).toHaveBeenCalledTimes(1)
    expect(h.onStopped.mock.calls.map(([failure]) => failure.message)).toEqual(['The YouTube proxy is not running.'])
    expect(h.onFailed).not.toHaveBeenCalled()
  })

  test('any other failure skips that song and carries on', async () => {
    const h = handlers({
      find: vi.fn(async (song) => {
        if (song === 'a') throw new Error('YouTube proxy returned 502 for /search')
        return { candidates: [song], nearMisses: [] }
      }),
    })
    await sweepHalf(['a', 'b'], h)
    expect(h.onFailed.mock.calls.map(([song]) => song)).toEqual(['a'])
    expect(h.onFound.mock.calls.map(([song]) => song)).toEqual(['b'])
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/ui/sweep.test.js`
Expected: FAIL, because `./sweep.js` does not exist.

- [ ] **Step 3: Write `sweep.js`**

Create `src/ui/sweep.js`:

```js
/**
 * One half of a catalogue search sweep: each song in turn, until the songs
 * run out, the sweep is stopped, or a failure ends the half. A dead proxy or
 * an expired session would fail every song after it too, so it ends the half;
 * any other failure skips that one song.
 *
 * Kept out of the hook so it is tested without React. See
 * docs/2026-10-08-catalogue-search-design.md §4 and §8.
 *
 * @param {Array} songs
 * @param {object} handlers
 * @param {(song) => Promise<object>} handlers.find
 * @param {() => boolean} handlers.live false once the sweep is stopped or superseded
 * @param {(song, twins) => void} handlers.onFound
 * @param {(song, failure) => void} handlers.onFailed
 * @param {(failure) => void} handlers.onStopped
 * @param {(failure) => boolean} handlers.isFatal
 */
export async function sweepHalf(songs, { find, live, onFound, onFailed, onStopped, isFatal }) {
  for (const song of songs) {
    if (!live()) return
    try {
      const twins = await find(song)
      // A result that lands after Stop is dropped.
      if (live()) onFound(song, twins)
    } catch (failure) {
      if (!live()) return
      if (isFatal(failure)) {
        onStopped(failure)
        return
      }
      onFailed(song, failure)
    }
  }
}
```

Run: `npx vitest run src/ui/sweep.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 4: Rewrite the hook**

Replace the whole of `src/ui/useMatchReview.js` with the code below. Everything from Plan A is kept: the double-click guard (I-2), the playlist retry (I-1), the busy fix (I-3), the null-key guards (M-3) and the playlist ticket. What changes:
- the sweep state and its ticket;
- `settled` is split from `result`, so a find never reruns `settlePairs`;
- `findOf` snapshots a find on confirm.

```js
/**
 * The match review: one Spotify playlist against a YouTube playlist the user
 * picks, with every decision kept in the match book, and a search of both
 * catalogues for the songs the two playlists do not pair.
 *
 * Read-only towards both services. Scoring is the slow half and runs once per
 * chosen playlist; settling reruns after every decision and every find. See
 * docs/2026-10-05-match-review-design.md and
 * docs/2026-10-08-catalogue-search-design.md.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { findOnSpotify, findOnYouTube } from '../match/findTwin.js'
import {
  forgetDecision,
  loadMatchBook,
  recordDecision,
  saveMatchBook,
  snapshotOf,
  spotifyKeyOf,
  verdictLookup,
} from '../match/matchBook.js'
import { scoreCandidates, settlePairs } from '../match/pairTracks.js'
import { settleFound } from '../match/settleFound.js'
import { AuthError } from '../services/spotify/client.js'
import { searchTracks } from '../services/spotify/search.js'
import { ProxyUnavailableError, YouTubeSessionExpiredError } from '../services/youtube/client.js'
import { toAppPlaylists } from '../services/youtube/playlists.js'
import { normalizeYouTubeSearchResults, normalizeYouTubeTracks } from '../services/youtube/track.js'
import { sweepHalf } from './sweep.js'

const NOTHING_FOUND = { forSpotify: new Map(), forYoutube: new Map() }

/** An episode or an unavailable row has no title to search for. */
const searchable = (track) => !track.isEpisode && !track.isUnavailable

export function useMatchReview({ youtube, spotify, spotifyTracks, storage = globalThis.localStorage }) {
  const [youtubePlaylists, setYoutubePlaylists] = useState([])
  const [chosenId, setChosenId] = useState(null)
  const [youtubeTracks, setYoutubeTracks] = useState([])
  const [scored, setScored] = useState(null)
  const [unavailable, setUnavailable] = useState(0)
  const [book, setBook] = useState(() => loadMatchBook(storage))
  const [remembered, setRemembered] = useState(true)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [found, setFound] = useState(NOTHING_FOUND)
  const [sweep, setSweep] = useState(null)
  const latest = useRef(0)
  const lastDecisionAt = useRef(0)
  const sweepTicket = useRef(0)

  // I-2: Confirm/Reject/Undo remove a row, the next one slides under the
  // pointer, and the second click of a double-click decides it too.
  // ponytail: a deliberate second click inside 400ms is dropped along with
  // the accidental one.
  const recentlyDecided = useCallback(() => {
    const now = Date.now()
    if (now - lastDecisionAt.current < 400) return true
    lastDecisionAt.current = now
    return false
  }, [])

  // I-1: lifted out of the effect so the red Notice's "Try again" can re-run
  // the same load without the user leaving the screen.
  const loadPlaylists = useCallback(() => {
    let live = true
    youtube
      .listPlaylists()
      .then((raw) => {
        if (!live) return
        setYoutubePlaylists(toAppPlaylists(raw))
        setError(null)
      })
      .catch((failure) => live && setError(failure.message))
    return () => {
      live = false
    }
  }, [youtube])

  useEffect(() => loadPlaylists(), [loadPlaylists])

  // Leaving the screen stops a sweep: its results would land on nothing.
  useEffect(
    () => () => {
      sweepTicket.current += 1
    },
    [],
  )

  const choose = useCallback(
    async (playlistId) => {
      // Only the latest choice may land: a slow first playlist resolving after
      // a second was chosen must never overwrite the second.
      const ticket = ++latest.current
      // Finds are about this playlist's leftovers; a new playlist starts clean.
      sweepTicket.current += 1
      setFound(NOTHING_FOUND)
      setSweep(null)
      setChosenId(playlistId || null)
      setScored(null)
      setYoutubeTracks([])
      setUnavailable(0)
      setError(null)
      if (!playlistId) {
        // I-3: picking the placeholder takes a new ticket, so the load it
        // superseded skips its own `finally` and never clears the meter.
        setBusy(null)
        return
      }
      try {
        setBusy('Reading the YouTube playlist')
        const fetched = await youtube.fetchPlaylist(playlistId)
        if (ticket !== latest.current) return
        const tracks = normalizeYouTubeTracks(fetched.tracks)
        setBusy('Matching')
        // Let the meter paint before ~0.35s of synchronous scoring.
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (ticket !== latest.current) return
        const candidates = scoreCandidates(spotifyTracks, tracks)
        setYoutubeTracks(tracks)
        setUnavailable(Math.max(0, (fetched.counted ?? 0) - (fetched.readable ?? 0)))
        setScored(candidates)
      } catch (failure) {
        if (ticket === latest.current) {
          setError(failure.message)
          // I-1: back to the placeholder, so picking the same playlist again
          // fires a change event and retries the fetch.
          setChosenId(null)
        }
      } finally {
        if (ticket === latest.current) setBusy(null)
      }
    },
    [youtube, spotifyTracks],
  )

  const youtubeIds = useMemo(() => new Set(youtubeTracks.map((track) => track.id)), [youtubeTracks])
  const spotifyKeys = useMemo(() => new Set(spotifyTracks.map(spotifyKeyOf)), [spotifyTracks])

  // Pairing the playlists does not depend on finds, so a find does not rerun it.
  const settled = useMemo(
    () => (scored ? settlePairs(spotifyTracks, youtubeTracks, scored, { verdictFor: verdictLookup(book) }) : null),
    [spotifyTracks, youtubeTracks, scored, book],
  )

  const result = useMemo(
    () =>
      settled &&
      settleFound(settled, {
        spotifyTracks,
        youtubeTracks,
        book,
        foundForSpotify: found.forSpotify,
        foundForYoutube: found.forYoutube,
      }),
    [settled, spotifyTracks, youtubeTracks, book, found],
  )

  // What a sweep would search: unmatched songs with a title, not searched
  // yet. One search serves a song listed twice.
  const unsearched = useMemo(() => {
    if (!result) return { spotify: [], youtube: [] }
    const spotifySongs = new Map()
    for (const track of result.unmatchedSpotify.filter(searchable)) {
      const key = spotifyKeyOf(track)
      if (key != null && !found.forSpotify.has(key) && !spotifySongs.has(key)) spotifySongs.set(key, track)
    }
    const youtubeSongs = result.unmatchedYoutube.filter(
      (track) => searchable(track) && track.id != null && !found.forYoutube.has(track.id),
    )
    return { spotify: [...spotifySongs.values()], youtube: youtubeSongs }
  }, [result, found])

  const searchAll = useCallback(async () => {
    const total = unsearched.spotify.length + unsearched.youtube.length
    if (total === 0) return
    const ticket = ++sweepTicket.current
    const live = () => ticket === sweepTicket.current
    setSweep({ done: 0, total, failed: 0, running: true, errors: [] })
    const advance = (failed) =>
      setSweep((prev) => prev && { ...prev, done: prev.done + 1, failed: prev.failed + failed })
    const stopHalf = (label) => (failure) =>
      setSweep((prev) => prev && { ...prev, errors: [...prev.errors, { label, message: failure.message }] })
    const searchYouTube = async (query, filter, limit) =>
      normalizeYouTubeSearchResults(await youtube.search(query, filter, limit))
    const searchSpotify = (query, limit) => searchTracks(spotify, query, limit)

    // The two services search side by side, each one song at a time.
    await Promise.all([
      sweepHalf(unsearched.spotify, {
        find: (song) => findOnYouTube(song, searchYouTube, { skipIds: youtubeIds }),
        live,
        onFound: (song, twins) => {
          setFound((prev) => ({ ...prev, forSpotify: new Map(prev.forSpotify).set(spotifyKeyOf(song), twins) }))
          advance(0)
        },
        onFailed: () => advance(1),
        onStopped: stopHalf('YouTube Music'),
        isFatal: (failure) => failure instanceof ProxyUnavailableError || failure instanceof YouTubeSessionExpiredError,
      }),
      sweepHalf(unsearched.youtube, {
        find: (song) => findOnSpotify(song, searchSpotify, { skipIds: spotifyKeys }),
        live,
        onFound: (song, twins) => {
          setFound((prev) => ({ ...prev, forYoutube: new Map(prev.forYoutube).set(song.id, twins) }))
          advance(0)
        },
        onFailed: () => advance(1),
        onStopped: stopHalf('Spotify'),
        isFatal: (failure) => failure instanceof AuthError,
      }),
    ])
    if (live()) setSweep((prev) => prev && { ...prev, running: false })
  }, [unsearched, youtube, spotify, youtubeIds, spotifyKeys])

  const stopSearch = useCallback(() => {
    sweepTicket.current += 1
    setSweep((prev) => prev && { ...prev, running: false })
  }, [])

  const commit = useCallback(
    (next) => {
      setBook(next)
      setRemembered(saveMatchBook(next, storage))
    },
    [storage],
  )

  // D29: a pair with a track in neither playlist is a find, and a confirmed
  // find keeps a snapshot of that track.
  const findOf = useCallback(
    (spotifyTrack, youtubeTrack) => {
      if (!youtubeIds.has(youtubeTrack.id)) return snapshotOf(youtubeTrack, 'youtube')
      if (!spotifyKeys.has(spotifyKeyOf(spotifyTrack))) return snapshotOf(spotifyTrack, 'spotify')
      return undefined
    },
    [youtubeIds, spotifyKeys],
  )

  const decide = useCallback(
    (spotifyTrack, youtubeTrack, verdict) => {
      if (recentlyDecided()) return
      const spotifyKey = spotifyKeyOf(spotifyTrack)
      // M-3: a track Spotify or YouTube no longer serves has no key to file
      // the decision under.
      if (spotifyKey == null || youtubeTrack?.id == null) return
      const find = verdict === 'same' ? findOf(spotifyTrack, youtubeTrack) : undefined
      commit(recordDecision(book, { spotifyKey, youtubeVideoId: youtubeTrack.id, verdict, found: find }))
    },
    [book, commit, recentlyDecided, findOf],
  )

  // One save for the whole group, not one per pair.
  const confirmAll = useCallback(
    (pairs) => {
      if (recentlyDecided()) return
      commit(
        pairs.reduce((next, pair) => {
          const spotifyKey = spotifyKeyOf(pair.spotify)
          if (spotifyKey == null || pair.youtube?.id == null) return next // M-3
          return recordDecision(next, {
            spotifyKey,
            youtubeVideoId: pair.youtube.id,
            verdict: 'same',
            found: findOf(pair.spotify, pair.youtube),
          })
        }, book),
      )
    },
    [book, commit, recentlyDecided, findOf],
  )

  const undo = useCallback(
    (pair) => {
      if (recentlyDecided()) return
      const spotifyKey = spotifyKeyOf(pair.spotify)
      if (spotifyKey == null || pair.youtube?.id == null) return // M-3
      commit(forgetDecision(book, spotifyKey, pair.youtube.id))
    },
    [book, commit, recentlyDecided],
  )

  return {
    youtubePlaylists,
    chosenId,
    choose,
    retryPlaylists: loadPlaylists,
    result,
    unavailable,
    busy,
    error,
    remembered,
    decide,
    confirmAll,
    undo,
    found,
    sweep,
    unsearchedCount: unsearched.spotify.length + unsearched.youtube.length,
    searchAll,
    stopSearch,
  }
}
```

- [ ] **Step 5: Rewrite the screen**

Replace the whole of `src/ui/screens/Review.jsx` with the code below. Everything from Plan A is kept. What changes:
- the sweep's progress section and its error notices;
- the "Search all unmatched" lever;
- `PickerRow` serves both unmatched groups, listing search results first;
- `TrackCell` takes a `note` for a found track;
- rows are keyed by their playlist-side track (`rowKey`).

```jsx
/**
 * Match review: which Spotify track is which YouTube track.
 *
 * Read-only. Decisions go to the match book; nothing is written to Spotify or
 * YouTube. Likely rows warm amber (pending) and settled rows take the green
 * seat (committed), reusing the board's data-moves and data-written states.
 * "Search all unmatched" looks for the leftovers' twins in the other
 * service's catalogue. See docs/2026-10-05-match-review-design.md §3 and
 * docs/2026-10-08-catalogue-search-design.md §6.
 */

import { spotifyKeyOf } from '../../match/matchBook.js'
import { closestTitles } from '../../match/pairTracks.js'
import { artistsOf, formatCount, formatDelta, titleOf } from '../format.js'
import { useMatchReview } from '../useMatchReview.js'
import { Frame, Head, Lever, LeverRow, Meter, Notice, QuietLever } from '../components/chrome.jsx'
import { UnlitField } from '../components/UnlitField.jsx'

export function ReviewScreen({ app }) {
  const { playlist, tracks, youtube, client, setScreen } = app
  const review = useMatchReview({ youtube, spotify: client, spotifyTracks: tracks })
  const { result, sweep } = review
  const tier = (name) => result?.pairs.filter((pair) => pair.tier === name) ?? []
  const likely = tier('likely')
  const strong = tier('strong')
  const settled = tier('certain')

  return (
    <Frame fill>
      <Head
        back={{ label: 'Back to sorting', onClick: () => setScreen('sort') }}
        title={playlist?.name ?? 'Playlist'}
        tally={
          result
            ? [
                { label: 'Strong', value: formatCount(strong.length) },
                { label: 'Likely', value: formatCount(likely.length), tone: likely.length ? 'amber' : undefined },
                { label: 'Settled', value: formatCount(settled.length), tone: settled.length ? 'green' : undefined },
                { label: 'Only Spotify', value: formatCount(result.unmatchedSpotify.length) },
                { label: 'Only YouTube', value: formatCount(result.unmatchedYoutube.length) },
              ]
            : []
        }
      />

      <div className="section">
        <label className="field-label" htmlFor="review-youtube">
          Match against
        </label>
        <select
          id="review-youtube"
          className="field"
          value={review.chosenId ?? ''}
          onChange={(event) => review.choose(event.target.value)}
        >
          <option value="">Choose a YouTube Music playlist</option>
          {review.youtubePlaylists.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({formatCount(item.trackCount)})
            </option>
          ))}
        </select>
        {review.unavailable > 0 ? (
          <p className="row-sub" style={{ marginTop: 8 }}>
            <span className="num">{formatCount(review.unavailable)}</span> unavailable on YouTube
          </p>
        ) : null}
      </div>

      {review.busy ? (
        <div className="section">
          <p className="col-label" style={{ marginBottom: 8 }}>
            {review.busy}
          </p>
          <Meter done={0} total={1} />
        </div>
      ) : null}

      {review.error ? (
        <div className="section">
          <Notice tone="red" title="Could not read YouTube Music">
            {review.error}
            <div style={{ marginTop: 10 }}>
              <QuietLever className="lever-quiet is-compact" onClick={review.retryPlaylists}>
                Try again
              </QuietLever>
            </div>
          </Notice>
        </div>
      ) : null}

      {review.remembered ? null : (
        <div className="section">
          <Notice tone="amber" title="Decisions will not be remembered">
            This browser is blocking storage for the page, so these decisions last only while this screen is open.
          </Notice>
        </div>
      )}

      {sweep ? (
        <div className="section">
          <p className="col-label" style={{ marginBottom: 8 }}>
            {sweep.running ? 'Searching' : 'Searched'} <span className="num">{formatCount(sweep.done)}</span> of{' '}
            <span className="num">{formatCount(sweep.total)}</span>
            {sweep.failed > 0 ? (
              <>
                {' · '}
                <span className="num">{formatCount(sweep.failed)}</span> searches failed
              </>
            ) : null}
          </p>
          <Meter done={sweep.done} total={sweep.total} />
          {sweep.running ? (
            <div style={{ marginTop: 10 }}>
              <QuietLever className="lever-quiet is-compact" onClick={review.stopSearch}>
                Stop
              </QuietLever>
            </div>
          ) : null}
        </div>
      ) : null}

      {sweep?.errors.map((failure) => (
        <div className="section" key={failure.label}>
          <Notice tone="red" title={`Could not search ${failure.label}`}>
            {failure.message}
          </Notice>
        </div>
      ))}

      {result ? (
        <div className="board board-review">
          <div className="board-cols" role="row">
            <span className="col-label">Spotify</span>
            <span className="col-label">YouTube Music</span>
            <span className="col-label">Length</span>
            <span className="col-label col-why">Why</span>
            <span className="col-label" />
          </div>

          <div className="board-scroll" role="table" aria-label="Matches">
            <GroupHeading count={likely.length}>Likely — check each one</GroupHeading>
            {likely.map((pair) => (
              <PairRow key={`l${rowKey(pair)}`} pair={pair} state="pending">
                <DecisionLevers pair={pair} review={review} />
              </PairRow>
            ))}

            <GroupHeading count={strong.length}>Strong</GroupHeading>
            {strong.map((pair) => (
              <PairRow key={`s${rowKey(pair)}`} pair={pair}>
                <DecisionLevers pair={pair} review={review} />
              </PairRow>
            ))}

            <GroupHeading count={result.unmatchedSpotify.length}>Only on Spotify</GroupHeading>
            {result.unmatchedSpotify.map((track) => (
              <PickerRow
                key={`o${track.originalIndex}`}
                track={track}
                side="spotify"
                searchOptions={searchOptionsOf(review.found.forSpotify.get(spotifyKeyOf(track)), 'youtube')}
                playlistOptions={closestTitles(track, result.unmatchedYoutube)}
                onPair={(chosen) => review.decide(track, chosen, 'same')}
              />
            ))}

            <GroupHeading count={result.unmatchedYoutube.length}>Only on YouTube</GroupHeading>
            {result.unmatchedYoutube.map((track) => (
              <PickerRow
                key={`y${track.originalIndex}`}
                track={track}
                side="youtube"
                searchOptions={searchOptionsOf(review.found.forYoutube.get(track.id), 'spotify')}
                playlistOptions={closestTitles(track, result.unmatchedSpotify)}
                onPair={(chosen) => review.decide(chosen, track, 'same')}
              />
            ))}

            <details className="review-settled">
              <summary className="review-group col-label">
                Settled (<span className="num">{formatCount(settled.length)}</span>)
              </summary>
              {settled.map((pair) => (
                <PairRow key={`c${rowKey(pair)}`} pair={pair} state="settled">
                  <QuietLever className="lever-quiet is-compact" onClick={() => review.undo(pair)}>
                    Undo
                  </QuietLever>
                </PairRow>
              ))}
            </details>

            <UnlitField />
          </div>
        </div>
      ) : null}

      <LeverRow>
        <QuietLever
          onClick={review.searchAll}
          disabled={!result || sweep?.running === true || review.unsearchedCount === 0}
        >
          Search all unmatched
        </QuietLever>
        <span className="spacer" />
        <Lever disabled={strong.length === 0} onClick={() => review.confirmAll(strong)}>
          Confirm all <span className="num">{formatCount(strong.length)}</span> strong
        </Lever>
      </LeverRow>
    </Frame>
  )
}

/**
 * A row is keyed by its playlist-side track: a found track's position in a
 * search result is not unique.
 */
const rowKey = (pair) =>
  pair.missingFrom === 'spotify' ? `y${pair.youtube.originalIndex}` : `p${pair.spotify.originalIndex}`

/** Everything a search turned up for one song, accepted first, for Pair with…. */
function searchOptionsOf(entry, side) {
  if (!entry) return []
  return [...entry.candidates.map((pair) => pair[side]), ...entry.nearMisses]
}

function GroupHeading({ count, children }) {
  return (
    <p className="review-group col-label">
      {children} (<span className="num">{formatCount(count)}</span>)
    </p>
  )
}

function DecisionLevers({ pair, review }) {
  return (
    <>
      <QuietLever className="lever-quiet is-compact" onClick={() => review.decide(pair.spotify, pair.youtube, 'same')}>
        Confirm
      </QuietLever>
      <QuietLever
        className="lever-quiet is-compact"
        onClick={() => review.decide(pair.spotify, pair.youtube, 'different')}
      >
        Reject
      </QuietLever>
    </>
  )
}

function PairRow({ pair, state, children }) {
  return (
    <div
      className="board-row"
      role="row"
      data-moves={state === 'pending' ? 'true' : undefined}
      data-written={state === 'settled' ? 'true' : undefined}
    >
      <TrackCell
        track={pair.spotify}
        href={spotifyHref(pair.spotify)}
        note={pair.missingFrom === 'spotify' ? 'Not in your Spotify playlist' : null}
      />
      <TrackCell
        track={pair.youtube}
        href={youtubeHref(pair.youtube)}
        note={pair.missingFrom === 'youtube' ? 'Not in your YouTube playlist' : null}
      />
      <span className="cell-end" role="cell">
        <span className="row-meta num">{formatDelta(pair.durationDeltaMs)}</span>
      </span>
      <span className="row-sub col-why" role="cell">
        {pair.reason}
      </span>
      <span className="cell-end review-levers" role="cell">
        {children}
      </span>
    </div>
  )
}

/**
 * An unmatched song and its Pair with… picker: what search turned up for it
 * first, then the other playlist's leftovers, closest title first. The picker
 * sits in the other service's column.
 */
function PickerRow({ track, side, searchOptions, playlistOptions, onPair }) {
  const options = [...searchOptions, ...playlistOptions]
  const other = side === 'spotify' ? 'YouTube' : 'Spotify'
  const own = <TrackCell track={track} href={side === 'spotify' ? spotifyHref(track) : youtubeHref(track)} />
  const picker = (
    <span role="cell">
      <select
        className="field field-compact"
        value=""
        aria-label={`Pair ${titleOf(track)} with a ${other} track`}
        onChange={(event) => {
          const chosen = options[Number(event.target.value)]
          if (chosen) onPair(chosen)
        }}
      >
        <option value="">Pair with…</option>
        {searchOptions.length > 0 ? (
          <optgroup label="Search results">
            {searchOptions.map((option, index) => (
              <option key={`f${option.id}`} value={index}>
                {titleOf(option)} — {artistsOf(option)}
              </option>
            ))}
          </optgroup>
        ) : null}
        {playlistOptions.length > 0 ? (
          <optgroup label={`In your ${other} playlist`}>
            {playlistOptions.map((option, index) => (
              <option key={`p${option.originalIndex}`} value={searchOptions.length + index}>
                {titleOf(option)} — {artistsOf(option)}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </span>
  )
  return (
    <div className="board-row" role="row">
      {side === 'spotify' ? own : picker}
      {side === 'spotify' ? picker : own}
      <span role="cell" />
      <span role="cell" className="col-why" />
      <span role="cell" />
    </div>
  )
}

function TrackCell({ track, href, note = null }) {
  return (
    <span className="cell-stack" role="cell">
      <span className="row-title">{titleOf(track)}</span>
      <span className="row-sub">
        {artistsOf(track)}
        {href ? (
          <>
            {' · '}
            <a className="row-play" href={href} target="_blank" rel="noreferrer">
              Play
            </a>
          </>
        ) : null}
      </span>
      {note ? <span className="row-sub">{note}</span> : null}
    </span>
  )
}

// A local file has no id and nothing to link to.
const spotifyHref = (track) => (track?.id ? `https://open.spotify.com/track/${track.id}` : null)
const youtubeHref = (track) => (track?.id ? `https://music.youtube.com/watch?v=${track.id}` : null)
```

- [ ] **Step 6: Wire the Spotify client and the row height**

In `src/ui/useSorterApp.js`, add `client,` to the object the hook returns, on the line after `youtube,`. (`client` is already in scope: `const { client } = auth` at the top of the hook.)

In `src/ui/board.css`, change the `.board-review` rule in the "Match review board" section (the first one, outside the media query) from

```css
.board-review {
  --cols: minmax(0, 1fr) minmax(0, 1fr) 9ch minmax(0, 0.8fr) 24ch;
}
```

to

```css
.board-review {
  --cols: minmax(0, 1fr) minmax(0, 1fr) 9ch minmax(0, 0.8fr) 24ch;
  /* Tall enough for a found track's third line, "Not in your … playlist". */
  --row-h: 58px;
}
```

58px is the height the playlists board already uses. The grid stays declared once per breakpoint.

- [ ] **Step 7: Verify**

Run: `npm test`, `npm run lint`, `npm run build` and `python -m pytest proxy`.
Expected: 624 JavaScript tests pass; the lint shows only the two existing warnings; the build is clean; 21 proxy tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/ui/sweep.js src/ui/sweep.test.js src/ui/useMatchReview.js src/ui/screens/Review.jsx src/ui/useSorterApp.js src/ui/board.css
git commit -m "Search all unmatched songs from the match review

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The walkthrough gate, then the record

This repo has no component-test infrastructure, so the spec makes a manual walkthrough the gate for both Plan A (whose own walkthrough was folded into this one) and Plan B. **The owner runs it in the browser.** The plan is not done until every step matches. The controller prepares it, hands it over, and waits.

**Files:**
- Modify: `docs/STATUS.md` (the 2b section)
- Modify: `docs/2026-09-18-youtube-mirror-design.md` (§8: export and import are deferred)
- Modify: `docs/2026-10-05-match-review-design.md` (D24 is superseded)

- [ ] **Step 1: Prepare**

Run `npm test`, `python -m pytest proxy`, `npm run lint` and `npm run build`. All must pass. Confirm the proxy has a live session: with `npm start` running, `curl -s -X POST http://127.0.0.1:8787/auth/status` must answer `{"authenticated":true}`. If it does not, the owner refreshes `proxy/browser.json` from a private window first (see `proxy/README.md`).

- [ ] **Step 2: The owner's walkthrough**

With `npm start` running, at http://127.0.0.1:5173.

**Part 1: Plan A, on the real pair.**

1. Open the Spotify playlist **Punjabi Songs**. **Match to YouTube** shows in the lever row.
2. Click it. The review screen opens with the dropdown and no board.
3. Choose **punjabi songs**. The meter shows "Reading the YouTube playlist", then "Matching", then the board.
   - The header reads **Strong 244 · Likely 63 · Settled 0 · Only Spotify 111 · Only YouTube 78**.
   - "4 unavailable on YouTube" sits under the dropdown.
4. **Confirm** one likely pair. Likely drops by one, Settled rises by one, and the row appears under Settled with the green seat.
5. **Reject** one strong pair. It leaves Strong. Its Spotify song either re-pairs with another YouTube track or shows under Only on Spotify.
6. Under Only on Spotify, find **No Need**. Its **Pair with…** list shows the `No Need (Full Video) Karan Aujla | …` upload **first** under "In your YouTube playlist". Pick it, and the pair moves to Settled.
7. Expand **Settled**, then **Undo** one. It returns to its group.
8. Click **Confirm all … strong**. Strong becomes 0 and Settled rises by the same number.
9. Choose a different YouTube playlist, then immediately choose **punjabi songs** again. The board shows punjabi songs, not the other playlist.
10. **Reload the page**, then reopen Punjabi Songs, Match to YouTube and punjabi songs. Every decision from steps 4–8 is still settled.
11. Click a **Play** link on each side. Spotify and YouTube Music open on that track.
12. Double-click **Confirm** on a likely row. Exactly one pair settles.
13. Stop the proxy, then open the review. A red notice offers **Try again**. Start the proxy and click it; the dropdown fills without leaving the screen.
14. Narrow the window to 680px or less. The Confirm and Reject levers and the track cells still fit.

**Part 2: Plan B, on the real pair.**

15. Click **Search all unmatched**.
    - "Searching N of M" shows with a meter and **Stop**.
    - Finds land row by row in Strong and Likely.
    - Each found track's cell carries a third line: "Not in your YouTube playlist" or "Not in your Spotify playlist".
16. When the sweep ends, Only on Spotify has dropped by roughly 90. The probe found 92 of 111; fewer if Part 1 settled some of those songs. Spot-check five strong finds with **Play** on both sides: each is the same song.
17. Under Only on Spotify, open **Parda Hata Do – Farooq Got Audio Mix**'s **Pair with…**. "Search results" lists **Parda Hata Do – Trap Mix** first. Pick it. The pair moves to Settled, with the marker.
18. **Reject** a found pair. Its song moves to its next find, or back to its unmatched group. Its Pair with… still offers the rejected track under "Search results".
19. Confirm a found pair, **reload the page**, and reopen the review. It is still under Settled with its marker, before any search.
20. Start a sweep and press **Stop**. The count freezes and **Search all unmatched** is available again; pressing it continues with only the songs not yet searched.
21. Start a sweep and choose another YouTube playlist while it runs. The new board shows no finds from the old one.
22. Start a sweep and stop the proxy while it runs. A red "Could not search YouTube Music" notice appears, and the Spotify side still finishes.

**Part 3: the owner's test playlists, both directions.**

23. Open the Spotify test playlist, then Match to YouTube, choose the YouTube test playlist, and **Search all unmatched**. For each side, record how many songs got a strong find, a likely find, and nothing, plus any find that is **not** the same song. A wrong strong find is a stop.

If any step differs, stop, report it to the controller, and fix it before going on.

- [ ] **Step 3: Record it**

In `docs/STATUS.md`, add to the end of the "YouTube Music: 2b matcher, audited" section (replace `DD` with the date the walkthrough passed, and fill in step 23's numbers):

```markdown
### Match review (Plan A) — done 2026-10-DD

A Spotify playlist's Sort screen opens a review against a YouTube Music
playlist: likely pairs first, then strong (with one-click Confirm all),
both unmatched lists, and settled pairs collapsed. Decisions are kept in
the match book (`localStorage`, `playlist-sorter:match-book`), keyed by
Spotify id or a local file's URI, so a reload keeps them. Pairing is
scored once per review and settled per click. Read-only: nothing is
written to either service. Walkthrough passed by the owner on the live
libraries.

### Catalogue search (Plan B) — done 2026-10-DD

One "Search all unmatched" button looks for every unmatched song's twin in
the other service's catalogue: Spotify → YouTube Music by ISRC first, then
title and artist among songs, then videos; YouTube Music → Spotify by field
search, then plain search. Every result is judged by `scorePair`; refused
results are offered as near misses in Pair with…. A confirmed find keeps a
snapshot of the found track in the match book, so it survives a reload and
Plan C knows what to add. Spec:
[2026-10-08-catalogue-search-design.md](2026-10-08-catalogue-search-design.md).

Replaying the recorded searches for the real 111 "Only on Spotify" songs
finds 88 strong and 4 likely in 165 searches. On the owner's test
playlists: Spotify → YouTube <S strong / L likely / N nothing>, YouTube →
Spotify <S / L / N>, wrong finds <count>.
```

In `docs/2026-09-18-youtube-mirror-design.md` §8, after the sentence ending "so it survives a cleared browser.", add the line:

```markdown
*Deferred (2026-10-05): export and import wait until the book holds real work; see the match review design §8.*
```

In `docs/2026-10-05-match-review-design.md` §2, at the end of the D24 row's last cell (after `Plan B`), append ` — superseded by D27 (catalogue search design, 2026-10-08)`.

- [ ] **Step 4: Commit**

```bash
git add docs/STATUS.md docs/2026-09-18-youtube-mirror-design.md docs/2026-10-05-match-review-design.md
git commit -m "Record the match review and catalogue search as done

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
