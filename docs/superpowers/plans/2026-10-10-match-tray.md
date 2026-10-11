# Match Tray Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the match review's Pair with… dropdown with a tray under each row, where one song is matched by the owner's own search, by a pasted link, or by listening to both sides first.

**Architecture:**
- **Pure pieces carry the logic:**
  - a link reader (`src/match/links.js`);
  - the matcher's verdict in words (`explainPair` in `scorePair.js`);
  - an ordering of search results (`rankResults` in `findTwin.js`);
  - two lookups with injected clients (`src/services/trackLookups.js`).
- **One read-only proxy route,** `GET /track/{videoId}`, looks up a pasted YouTube link. Spotify's single-track endpoint looks up a Spotify one.
- **The tray** (`MatchTray.jsx`, styled in `review.css`) opens beneath its row on the review screen.
- **A committed `playwright-cli` script** checks that no column spills at any width.

**Tech Stack:** React 19 (JavaScript, not TypeScript), Vite 8, Vitest 3, Oxlint; the proxy is FastAPI + ytmusicapi 1.12.3, tested with pytest; `playwright-cli` (already installed globally) runs the layout check.

**Spec:** [docs/2026-10-10-match-tray-design.md](../../2026-10-10-match-tray-design.md). It builds on [docs/2026-10-08-catalogue-search-design.md](../../2026-10-08-catalogue-search-design.md) and [docs/2026-10-05-match-review-design.md](../../2026-10-05-match-review-design.md). Read the first in full before starting.

## Global Constraints

- **Read-only.** Nothing is written to Spotify or YouTube. The only new proxy route is `GET /track/{videoId}`.
- **No new dependencies.** `package.json` and `proxy/requirements.txt` do not change.
- **The match book is unchanged:** storage key `playlist-sorter:match-book`, decision shape, and snapshots (D29) as they are.
- **Spotify asks stay within development-mode limits:** search asks for at most 10 results, and a link is looked up with `GET /v1/tracks/{id}` (the batch endpoint is gone).
- **Lint:** `npm run lint` currently reports exactly two warnings, in `src/ui/components/Flap.jsx` and `src/auth/useAuth.js`. It must report no others.
- **DESIGN.md rules:**
  - Colour only states a fact: amber is pending, green is committed/settled, red is an error (the Quarantined Colour Rule).
  - Every numeral is in a `.num` element.
  - Corners are square everywhere.
  - No new shadows.
  - Condensed uppercase is for labels, controls and headings only; prose is sentence case.
  - Each screen declares its board grid once per breakpoint, on its `.board-*` class.
  - Controls are built from the board's own materials (the Board Furniture Rule).
- **Git:** always `git add` explicit paths, never `git add -A` or `git add .`. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Commands,** from the repo root:
  - `npm test`: all JavaScript tests. 630 pass before this plan, 655 after Task 1, 679 after Task 2.
  - `python -m pytest proxy`: 21 pass before, 25 after Task 1.
  - `npm run lint` and `npm run build`.
- **Testing is on "test punjabi songs"** on the owner's test profiles in Spotify and YouTube Music, never the real library.

## Review Focus

The ways this most likely breaks for a real person, each pinned where it is owned:

1. **A link pasted with tracking junk, a locale segment, or no scheme** (`?si=…`, `/intl-de/`, `open.spotify.com/track/…`) must still pair; an album or playlist link must not. Pinned in Task 1 (`parseTrackLink` tests).
2. **A link for the wrong service** (a Spotify link in a song that needs YouTube Music) must say so plainly and look nothing up. Pinned in Task 2 (`lookupLink` tests).
3. **A YouTube link to a deleted, private or unknown video:** YouTube answers it with a server error, not an empty list. It must read as "That track could not be found.", not as a proxy failure. Pinned in Task 1 (proxy test) and Task 2 (`lookupLink` test).
4. **Long titles and artist lists in the tray, at any width:** nothing may run into the next column, and the buttons must not cover the length. Pinned in Task 4 (the column check, which opens all three kinds of tray at six widths).
5. **Deciding during a sweep:** Pair, Confirm, Reject and Undo inside the tray must wait, exactly as on the board. Pinned in Task 3 (`deciding` is passed to the tray) and walkthrough step 25.

---

### Task 1: Looking up one track

**Files:**
- Create: `src/match/links.js`, `src/match/links.test.js`
- Modify: `proxy/app.py` (import `YTMusicServerError`; append the `/track` route)
- Modify: `proxy/test_app.py` (import; `RaisingYT` gains `get_watch_playlist`; four tests)
- Modify: `src/services/youtube/client.js` (add `track`), `src/services/youtube/client.test.js` (two tests)
- Modify: `src/services/youtube/track.js` (read a `length` like `2:16`), `src/services/youtube/track.test.js` (one test)
- Modify: `src/services/spotify/search.js` (add `getTrack`), `src/services/spotify/search.test.js` (one test)

**Interfaces:**
- Consumes: the existing `request` helper in the YouTube client; `normalizePlaylistItem` and the Spotify client's `get`.
- Produces:
  - `parseTrackLink(text) → { service: 'spotify' | 'youtube', id } | null`;
  - `GET /track/{videoId} → { track: <watch-playlist track dict> | null }`;
  - `youtube.track(videoId) → Promise<raw track | null>`;
  - `getTrack(client, id) → Promise<Track>`;
  - `normalizeYouTubeSearchResults` reads `length` when `duration_seconds` is absent.

- [ ] **Step 1: Write the failing link reader tests**

Create `src/match/links.test.js`:

```js
import { describe, expect, test } from 'vitest'
import { parseTrackLink } from './links.js'

// Real ids: Taal Se Taal (Remix) on Spotify, and AJA's official video on YouTube.
const SPOTIFY = { service: 'spotify', id: '7fnd0BMPbWuMsn6lBrshZL' }
const YOUTUBE = { service: 'youtube', id: 'q7e348rz27I' }

describe('parseTrackLink', () => {
  test.each([
    ['https://open.spotify.com/track/7fnd0BMPbWuMsn6lBrshZL', SPOTIFY],
    ['https://open.spotify.com/track/7fnd0BMPbWuMsn6lBrshZL?si=4f1c2d3e4b5a6978', SPOTIFY],
    ['https://open.spotify.com/intl-de/track/7fnd0BMPbWuMsn6lBrshZL', SPOTIFY],
    ['open.spotify.com/track/7fnd0BMPbWuMsn6lBrshZL', SPOTIFY],
    ['spotify:track:7fnd0BMPbWuMsn6lBrshZL', SPOTIFY],
    ['  https://open.spotify.com/track/7fnd0BMPbWuMsn6lBrshZL  ', SPOTIFY],
    ['https://music.youtube.com/watch?v=q7e348rz27I', YOUTUBE],
    ['https://music.youtube.com/watch?v=q7e348rz27I&list=RDAMVMq7e348rz27I', YOUTUBE],
    ['https://www.youtube.com/watch?v=q7e348rz27I&t=42s', YOUTUBE],
    ['https://m.youtube.com/watch?v=q7e348rz27I', YOUTUBE],
    ['https://youtu.be/q7e348rz27I?si=AbCdEf', YOUTUBE],
  ])('%s is one song', (text, expected) => {
    expect(parseTrackLink(text)).toEqual(expected)
  })

  test.each([
    ['an album', 'https://open.spotify.com/album/1ATL5GLyefJaxhQzSPVrLX'],
    ['a playlist', 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'],
    ['a YouTube playlist', 'https://music.youtube.com/playlist?list=PL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i'],
    ['a watch page with no video', 'https://www.youtube.com/watch?list=PL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i'],
    ['a search page', 'https://music.youtube.com/search?q=sheesha'],
    ['a short Spotify id', 'https://open.spotify.com/track/7fnd0BMP'],
    ['a short video id', 'https://youtu.be/q7e348'],
    ['another site', 'https://example.com/watch?v=q7e348rz27I'],
    ['plain text', 'Sheesha Karan Aujla'],
    ['nothing', ''],
  ])('%s is not one song', (_, text) => {
    expect(parseTrackLink(text)).toBeNull()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/match/links.test.js`
Expected: FAIL, because `./links.js` does not exist.

- [ ] **Step 3: Write the link reader**

Create `src/match/links.js`:

```js
/**
 * Reading a pasted link as one song on Spotify or YouTube Music, for pairing
 * by link in the match tray. See docs/2026-10-10-match-tray-design.md §5.
 *
 * Pure. An album, a playlist, a search page or plain text is not one song, and
 * reads as null.
 */

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const YOUTUBE_HOSTS = new Set(['music.youtube.com', 'youtube.com', 'm.youtube.com'])

/** @returns {{service: 'spotify'|'youtube', id: string}|null} */
export function parseTrackLink(text) {
  const value = String(text ?? '').trim()
  const uri = /^spotify:track:(\w+)$/.exec(value)
  if (uri) return spotify(uri[1])

  const url = toUrl(value)
  if (!url) return null
  const host = url.hostname.replace(/^www\./, '')
  if (host === 'open.spotify.com') {
    // A localized link carries an /intl-xx/ segment before the type.
    const [type, id] = url.pathname.split('/').filter((part) => part && !part.startsWith('intl-'))
    return type === 'track' ? spotify(id) : null
  }
  if (host === 'youtu.be') return youtube(url.pathname.slice(1))
  if (YOUTUBE_HOSTS.has(host) && url.pathname === '/watch') return youtube(url.searchParams.get('v'))
  return null
}

/** A link pasted without its scheme is still a link. */
function toUrl(value) {
  for (const candidate of [value, `https://${value}`]) {
    try {
      return new URL(candidate)
    } catch {
      // Try the next form.
    }
  }
  return null
}

const spotify = (id) => (SPOTIFY_ID.test(id ?? '') ? { service: 'spotify', id } : null)
const youtube = (id) => (YOUTUBE_ID.test(id ?? '') ? { service: 'youtube', id } : null)
```

Run: `npx vitest run src/match/links.test.js`
Expected: PASS, 21 tests.

- [ ] **Step 4: Write the failing proxy tests**

In `proxy/test_app.py`:

(a) After the line `import app as proxy`, add:

```python
from ytmusicapi.exceptions import YTMusicServerError
```

(b) In the existing `RaisingYT` class, directly after its `search` method, add:

```python

    def get_watch_playlist(self, videoId=None, limit=25):
        raise RuntimeError(self._message)
```

(c) Append to the end of the file:

```python
class WatchYT:
    def __init__(self, tracks=None, raises=None):
        self._tracks = tracks or []
        self._raises = raises
        self.calls = []

    def get_watch_playlist(self, videoId=None, limit=25):
        self.calls.append({"videoId": videoId, "limit": limit})
        if self._raises:
            raise self._raises
        return {"tracks": self._tracks}


# Fields verbatim from get_watch_playlist on AJA's official video, 2026-10-10.
AJA = {
    "videoId": "q7e348rz27I",
    "title": "AJA - Kaléra (Feat. Jaski)",
    "artists": [{"name": "Kaléra", "id": "UCuQZ7xv7in6zanA6QaZ0MGg"}],
    "album": None,
    "length": "2:16",
    "videoType": "MUSIC_VIDEO_TYPE_OMV",
}


def test_track_passes_the_video_through(client, monkeypatch):
    fake = WatchYT(tracks=[AJA, {"videoId": "next0000000", "title": "Up next"}])
    monkeypatch.setattr(proxy, "get_client", lambda: fake)
    assert client.get("/track/q7e348rz27I").json() == {"track": AJA}
    assert fake.calls == [{"videoId": "q7e348rz27I", "limit": 1}]


def test_a_missing_video_is_no_track(client, monkeypatch):
    # Measured: YouTube answers an unknown id with a server error, not an empty list.
    fake = WatchYT(raises=YTMusicServerError("No content returned by the server."))
    monkeypatch.setattr(proxy, "get_client", lambda: fake)
    response = client.get("/track/aaaaaaaaaaa")
    assert response.status_code == 200
    assert response.json() == {"track": None}


def test_a_queue_that_starts_elsewhere_is_no_track(client, monkeypatch):
    fake = WatchYT(tracks=[{"videoId": "someoneelse", "title": "Something else"}])
    monkeypatch.setattr(proxy, "get_client", lambda: fake)
    assert client.get("/track/q7e348rz27I").json() == {"track": None}


def test_track_failure_is_clean_and_drops_the_cached_client(client, monkeypatch):
    monkeypatch.setattr(proxy, "_client", RaisingYT())
    response = client.get("/track/q7e348rz27I")
    assert response.status_code == 502
    assert "leaky detail" not in response.text
    assert proxy._client is None
```

Run: `python -m pytest proxy -q`
Expected: 4 FAIL (the route does not exist), 21 pass.

- [ ] **Step 5: Add the route**

In `proxy/app.py`, after `from ytmusicapi import YTMusic`, add `from ytmusicapi.exceptions import YTMusicServerError`. Then append to the end of the file:

```python
@app.get("/track/{video_id}")
def get_track(video_id: str) -> dict:
    """One video as a track, for pairing by a pasted link (match tray design §5).

    The first track of the video's watch playlist carries the fields a search
    result does: title, artists, album, length and videoType. YouTube answers
    a video that does not exist, or is private, with a server error rather
    than an empty list, so that error reads as no track.
    """
    try:
        tracks = get_client().get_watch_playlist(videoId=video_id, limit=1).get("tracks") or []
    except YTMusicServerError:
        return {"track": None}
    except Exception:
        reset_client()
        # Never interpolate the exception's own string (see get_playlist).
        raise HTTPException(status_code=502, detail="Could not reach YouTube Music.")
    first = tracks[0] if tracks else None
    return {"track": first if first and first.get("videoId") == video_id else None}
```

Run: `python -m pytest proxy -q`
Expected: 25 passed.

- [ ] **Step 6: Write the failing client, normalizer and Spotify tests**

In `src/services/youtube/client.test.js`, insert directly before the test named `'throws ProxyUnavailableError when the proxy cannot be reached'`:

```js
  test('looks up one video by id', async () => {
    const fetchImpl = vi.fn(async () => ok({ track: { videoId: 'q7e348rz27I' } }))
    expect(await clientWith(fetchImpl).track('q7e348rz27I')).toEqual({ videoId: 'q7e348rz27I' })
    expect(fetchImpl.mock.calls[0][0]).toBe('http://127.0.0.1:8787/track/q7e348rz27I')
  })

  test('a video YouTube does not have is null', async () => {
    expect(await clientWith(vi.fn(async () => ok({ track: null }))).track('aaaaaaaaaaa')).toBeNull()
  })

```

In `src/services/youtube/track.test.js`, inside `describe('normalizeYouTubeSearchResults', …)`, insert directly before the test named `'drops a result with no videoId, which can be neither played nor paired'`:

```js
  test('reads a watch-playlist track, which gives its length only as text', () => {
    // Shape verbatim from get_watch_playlist on AJA's official video, 2026-10-10.
    const watched = { ...AJA_VIDEO, duration_seconds: undefined, length: '2:16' }
    expect(normalizeYouTubeSearchResults([watched])[0].durationMs).toBe(136000)
    expect(normalizeYouTubeSearchResults([{ ...watched, length: '1:02:03' }])[0].durationMs).toBe(3723000)
    expect(normalizeYouTubeSearchResults([{ ...watched, length: 'LIVE' }])[0].durationMs).toBe(0)
  })

```

In `src/services/spotify/search.test.js`, change `import { searchTracks } from './search.js'` to `import { getTrack, searchTracks } from './search.js'`, and append to the end of the file:

```js
describe('getTrack', () => {
  test('reads one track by id, normalized as a playlist row is', async () => {
    const client = clientAnswering(track('7fnd0BMPbWuMsn6lBrshZL', 'Taal Se Taal - Remix', 'Alka Yagnik', 164848))
    const found = await getTrack(client, '7fnd0BMPbWuMsn6lBrshZL')
    expect(client.get).toHaveBeenCalledWith('/tracks/7fnd0BMPbWuMsn6lBrshZL')
    expect(found).toMatchObject({
      id: '7fnd0BMPbWuMsn6lBrshZL',
      name: 'Taal Se Taal - Remix',
      durationMs: 164848,
      source: 'spotify',
    })
  })
})
```

Run: `npx vitest run src/services`
Expected: FAIL: `track is not a function`, `getTrack is not a function`, and the watch-playlist length test fails (its durationMs is 0).

- [ ] **Step 7: Add the client call, the length reading and `getTrack`**

In `src/services/youtube/client.js`, directly after the `search` method inside the returned object, add:

```js

    /** One video as a track, or null when YouTube has no such video. */
    async track(videoId) {
      const body = await request(`/track/${encodeURIComponent(videoId)}`)
      return body?.track ?? null
    },
```

In `src/services/youtube/track.js`, inside `toTrack`, replace the line `    durationMs: (raw.duration_seconds ?? 0) * 1000,` with:

```js
    // A watch-playlist track (a pasted link) gives its length only as text.
    durationMs: (raw.duration_seconds ?? secondsOf(raw.length)) * 1000,
```

and append to the end of that file:

```js
/** "2:16" or "1:02:03" as seconds; 0 for anything else. */
function secondsOf(length) {
  const parts = String(length ?? '').split(':')
  if (parts.length < 2 || parts.some((part) => !/^\d+$/.test(part))) return 0
  return parts.reduce((total, part) => total * 60 + Number(part), 0)
}
```

In `src/services/spotify/search.js`, append to the end of the file:

```js
/**
 * One track by id, for pairing by a pasted link. A development-mode app may
 * still read one track; only the batch endpoint went in February 2026.
 */
export async function getTrack(client, id) {
  return normalizePlaylistItem({ track: await client.get(`/tracks/${encodeURIComponent(id)}`) }, 0)
}
```

Run: `npx vitest run src/services src/match/links.test.js`
Expected: PASS.

- [ ] **Step 8: Run the whole suite and the lint**

Run: `npm test`, `python -m pytest proxy` and `npm run lint`.
Expected: 655 JavaScript tests pass; 25 proxy tests pass; the lint shows only the two existing warnings.

- [ ] **Step 9: Commit**

```bash
git add src/match/links.js src/match/links.test.js proxy/app.py proxy/test_app.py src/services/youtube/client.js src/services/youtube/client.test.js src/services/youtube/track.js src/services/youtube/track.test.js src/services/spotify/search.js src/services/spotify/search.test.js
git commit -m "Look up the one track a pasted Spotify or YouTube link names

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: What the tray says

**Files:**
- Modify: `src/match/scorePair.js` (append `explainPair` and its helper), `src/match/scorePair.test.js` (import; five tests)
- Modify: `src/match/findTwin.js` (import `explainPair`; append `rankResults`), `src/match/findTwin.test.js` (import; four tests)
- Create: `src/services/trackLookups.js`, `src/services/trackLookups.test.js`
- Modify: `src/ui/format.js` (append `openHref`), `src/ui/format.test.js` (import; three cases)

**Interfaces:**
- Consumes:
  - Task 1's `parseTrackLink`, `youtube.track` and `getTrack`;
  - the existing `scorePair`, its internals `essentialTitle`, `bylineNames`, `spotifyNames`, `sharesAnArtist`, `foldTitle` and `STRONG_DRIFT_MS`;
  - `TIER_RANK`, `searchTracks`, `SEARCH_LIMIT`, `normalizeYouTubeSearchResults`.
- Produces:
  - `explainPair(spotify, youtube) → string`;
  - `rankResults(song, results, { side, inOtherPlaylist? }) → Array<{ track, verdict, accepted, already }>`, where `side` is the service the results come from;
  - `searchCatalogue(text, side, { youtube, spotify }) → Promise<Track[]>`;
  - `lookupLink(text, side, { youtube, spotify }) → Promise<{ track } | { error }>`;
  - `openHref(track) → string | null`.

- [ ] **Step 1: Write the failing tests**

In `src/match/scorePair.test.js`, add `explainPair,` to the import list from `'./scorePair.js'` (after `VIDEO_MAX_DRIFT_MS,`), and append to the end of the file:

```js
describe('explainPair', () => {
  test('an accepted pair gives its tier and the matcher\'s own reason', () => {
    expect(explainPair(track(), track())).toBe('strong: title and artist match exactly')
    expect(explainPair(track(), track({ durationMs: 191000 }))).toBe('likely: the durations differ by 3s')
  })

  test('a refused pair lists every fact that differs', () => {
    const other = video({ name: 'Something Else Entirely', ...credits('Nobody'), durationMs: 300000 })
    expect(explainPair(track(), other)).toBe('no match: lengths differ by 112s, different title, no artist in common')
  })

  test('the same song too far apart in length says only that', () => {
    expect(explainPair(track(), track({ durationMs: 228000 }))).toBe('no match: lengths differ by 40s')
  })

  test('decoration around the same title is not a different title', () => {
    const decorated = video({ name: 'Karan Aujla - Antidote (Official Video)', durationMs: 248000 })
    expect(explainPair(track(), decorated)).toBe('no match: lengths differ by 60s')
  })

  test('a side with no length says there is nothing to compare', () => {
    expect(explainPair(track({ durationMs: 0 }), track())).toBe('no match: no length to compare')
  })
})
```

(`track`, `video` and `credits` are helpers already defined in that file.)

In `src/match/findTwin.test.js`, change the import from `'./findTwin.js'` to `import { findOnSpotify, findOnYouTube, rankResults } from './findTwin.js'`, and append to the end of the file:

```js
describe('rankResults', () => {
  const brown = spotify(
    '2w8OTd8nwVEcDA60S4Ws92',
    'BROWN BROWN RANG',
    ['Chani Nattan', 'Inderpal Moga', 'Karam Brar', 'G-Funk'],
    176818,
    'US38Y2507058',
    'NICE DAY IN THE PIND',
  )
  const [arabic, exact] = normalizeYouTubeSearchResults([
    result('u1n1E3PMm0A', 'انا 5 استار على كوكبى', ['Hamo El Morshedy'], 279, OMV),
    result('26Ec977sp8A', 'BROWN BROWN RANG', ['Chani Nattan', 'Inderpal Moga', 'Karam Brar', 'G-Funk'], 177, ATV, 'NICE DAY IN THE PIND'),
  ])

  test('what the matcher accepts comes first, each result with its verdict', () => {
    expect(rankResults(brown, [arabic, exact], { side: 'youtube' }).map((row) => [row.track.id, row.accepted, row.verdict])).toEqual([
      ['26Ec977sp8A', true, 'strong: title and artist match exactly'],
      ['u1n1E3PMm0A', false, 'no match: lengths differ by 102s, different title, no artist in common'],
    ])
  })

  test('refused results keep their search order', () => {
    const later = { ...arabic, id: 'second00000' }
    expect(rankResults(brown, [arabic, later], { side: 'youtube' }).map((row) => row.track.id)).toEqual([
      'u1n1E3PMm0A',
      'second00000',
    ])
  })

  test('a result already in the other playlist is marked', () => {
    const rows = rankResults(brown, [arabic, exact], { side: 'youtube', inOtherPlaylist: (track) => track.id === '26Ec977sp8A' })
    expect(rows.map((row) => [row.track.id, row.already])).toEqual([
      ['26Ec977sp8A', true],
      ['u1n1E3PMm0A', false],
    ])
  })

  test('Spotify results are judged with the song on the YouTube side', () => {
    const sheeshaVideo = normalizeYouTubeSearchResults([
      result('sheeshaOMV', 'Sheesha | Karan Aujla | J Statik | Sagar Deol | New Punjabi Song 2022', ['Karan Aujla'], 176, OMV),
    ])[0]
    const slowed = spotify('s2', 'Sheesha (Slowed + Reverb)', ['Karan Aujla'], 200000, null, 'Sheesha')
    const sheesha = spotify('s1', 'Sheesha', ['Karan Aujla'], 161000, null, 'Sheesha')
    expect(rankResults(sheeshaVideo, [slowed, sheesha], { side: 'spotify' }).map((row) => [row.track.id, row.verdict])).toEqual([
      ['s1', 'likely: the durations differ by 15s'],
      ['s2', 'no match: lengths differ by 24s, different title'],
    ])
  })
})
```

(`spotify`, `result`, `ATV` and `OMV` are already defined in that file.)

Create `src/services/trackLookups.test.js`:

```js
import { describe, expect, test, vi } from 'vitest'
import { lookupLink, searchCatalogue } from './trackLookups.js'

// Shapes verbatim from ytmusicapi on 2026-10-08/10: a search result, and a
// watch-playlist track (a pasted link), which gives its length only as text.
const result = (videoId, title, seconds, videoType = 'MUSIC_VIDEO_TYPE_ATV') => ({
  videoId,
  title,
  artists: [{ name: 'Karan Aujla', id: null }],
  album: null,
  duration_seconds: seconds,
  videoType,
})
const AJA_WATCHED = {
  videoId: 'q7e348rz27I',
  title: 'AJA - Kaléra (Feat. Jaski)',
  artists: [{ name: 'Kaléra', id: 'UCuQZ7xv7in6zanA6QaZ0MGg' }],
  album: null,
  length: '2:16',
  videoType: 'MUSIC_VIDEO_TYPE_OMV',
}
const spotifyTrack = (id, name, durationMs) => ({
  id,
  uri: `spotify:track:${id}`,
  type: 'track',
  name,
  duration_ms: durationMs,
  artists: [{ id: 'a', name: 'Karan Aujla' }],
  album: { id: 'al', name: name, release_date: '2022-06-17', release_date_precision: 'day' },
})

describe('searchCatalogue', () => {
  test('on YouTube Music, runs songs and videos and lists each video once', async () => {
    const youtube = {
      search: vi.fn(async (_, filter) =>
        filter === 'songs'
          ? [result('s1', 'Sheesha', 161), result('v1', 'Sheesha (Official Video)', 176, 'MUSIC_VIDEO_TYPE_OMV')]
          : [result('v1', 'Sheesha (Official Video)', 176, 'MUSIC_VIDEO_TYPE_OMV'), result('v2', 'Sheesha Lyrics', 162, 'MUSIC_VIDEO_TYPE_UGC')],
      ),
    }
    const found = await searchCatalogue('sheesha Karan Aujla', 'youtube', { youtube })
    expect(found.map((track) => track.id)).toEqual(['s1', 'v1', 'v2'])
    expect(youtube.search.mock.calls).toEqual([
      ['sheesha Karan Aujla', 'songs', 10],
      ['sheesha Karan Aujla', 'videos', 5],
    ])
  })

  test('on Spotify, runs the text as typed with the 10-result limit', async () => {
    const spotify = { get: vi.fn(async () => ({ tracks: { items: [spotifyTrack('t1', 'Sheesha', 161000)] } })) }
    const found = await searchCatalogue('sheesha Karan Aujla', 'spotify', { spotify })
    expect(found.map((track) => track.id)).toEqual(['t1'])
    expect(spotify.get).toHaveBeenCalledWith('/search', { query: { q: 'sheesha Karan Aujla', type: 'track', limit: 10 } })
  })
})

describe('lookupLink', () => {
  test('a YouTube Music link reads as that video, with its length', async () => {
    const youtube = { track: vi.fn(async () => AJA_WATCHED) }
    const { track } = await lookupLink('https://music.youtube.com/watch?v=q7e348rz27I', 'youtube', { youtube })
    expect(youtube.track).toHaveBeenCalledWith('q7e348rz27I')
    expect(track).toMatchObject({ id: 'q7e348rz27I', name: 'AJA - Kaléra (Feat. Jaski)', durationMs: 136000 })
  })

  test('a Spotify link reads as that track', async () => {
    const spotify = { get: vi.fn(async () => spotifyTrack('7fnd0BMPbWuMsn6lBrshZL', 'Taal Se Taal - Remix', 164848)) }
    const { track } = await lookupLink('https://open.spotify.com/track/7fnd0BMPbWuMsn6lBrshZL', 'spotify', { spotify })
    expect(spotify.get).toHaveBeenCalledWith('/tracks/7fnd0BMPbWuMsn6lBrshZL')
    expect(track).toMatchObject({ id: '7fnd0BMPbWuMsn6lBrshZL', durationMs: 164848 })
  })

  test.each([
    ['https://open.spotify.com/track/7fnd0BMPbWuMsn6lBrshZL', 'youtube', "That's a Spotify link. This song needs a YouTube Music one."],
    ['https://youtu.be/q7e348rz27I', 'spotify', "That's a YouTube link. This song needs a Spotify one."],
    ['https://open.spotify.com/album/1ATL5GLyefJaxhQzSPVrLX', 'spotify', "That isn't a link to one song on Spotify."],
    ['Sheesha Karan Aujla', 'youtube', "That isn't a link to one song on YouTube Music."],
  ])('%s for %s is refused without a lookup', async (text, side, error) => {
    const youtube = { track: vi.fn() }
    const spotify = { get: vi.fn() }
    expect(await lookupLink(text, side, { youtube, spotify })).toEqual({ error })
    expect(youtube.track).not.toHaveBeenCalled()
    expect(spotify.get).not.toHaveBeenCalled()
  })

  test('a video YouTube does not have could not be found', async () => {
    const youtube = { track: vi.fn(async () => null) }
    expect(await lookupLink('https://youtu.be/aaaaaaaaaaa', 'youtube', { youtube })).toEqual({
      error: 'That track could not be found.',
    })
  })

  test.each([404, 400])('a Spotify %i could not be found', async (status) => {
    const spotify = { get: vi.fn(async () => Promise.reject(Object.assign(new Error('Not found'), { status }))) }
    expect(await lookupLink('spotify:track:7fnd0BMPbWuMsn6lBrshZL', 'spotify', { spotify })).toEqual({
      error: 'That track could not be found.',
    })
  })

  test('any other failure says what went wrong', async () => {
    const message = 'The YouTube proxy is not running. `npm start` runs it alongside the app, or `npm run dev:proxy` runs it alone.'
    const youtube = { track: vi.fn(async () => Promise.reject(new Error(message))) }
    expect(await lookupLink('https://youtu.be/q7e348rz27I', 'youtube', { youtube })).toEqual({ error: message })
  })
})
```

In `src/ui/format.test.js`, change `import { formatDelta } from './format.js'` to `import { formatDelta, openHref } from './format.js'`, and append to the end of the file:

```js
test.each([
  [{ id: '7fnd0BMPbWuMsn6lBrshZL', source: 'spotify' }, 'https://open.spotify.com/track/7fnd0BMPbWuMsn6lBrshZL'],
  [{ id: 'q7e348rz27I', source: 'youtube' }, 'https://music.youtube.com/watch?v=q7e348rz27I'],
  [{ id: null, source: 'spotify', isLocal: true }, null],
])('%o opens at %s', (track, expected) => {
  expect(openHref(track)).toBe(expected)
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/match src/services/trackLookups.test.js src/ui/format.test.js`
Expected: FAIL. `explainPair`, `rankResults` and `openHref` are not functions, and `./trackLookups.js` does not exist.

- [ ] **Step 3: Write `explainPair`**

Append to the end of `src/match/scorePair.js` (it uses the file's own `scorePair`, `foldTitle`, `essentialTitle`, `bylineNames`, `spotifyNames`, `sharesAnArtist` and `STRONG_DRIFT_MS`):

```js
/**
 * The matcher's verdict on a pair, in words, for the match tray (design §7).
 * An accepted pair gives its tier and scorePair's own reason. A refused pair
 * lists the facts that differ, or "a different version" when none does — a
 * remix, a live cut or a sequel that scorePair refuses on its tags.
 */
export function explainPair(spotify, youtube) {
  const scored = scorePair(spotify, youtube)
  if (scored) return `${scored.tier}: ${scored.reason.charAt(0).toLowerCase()}${scored.reason.slice(1)}`
  const facts = []
  const drift = Math.round(Math.abs((youtube?.durationMs ?? 0) - (spotify?.durationMs ?? 0)) / 1000)
  if (!(spotify?.durationMs > 0) || !(youtube?.durationMs > 0)) facts.push('no length to compare')
  else if (drift > STRONG_DRIFT_MS / 1000) facts.push(`lengths differ by ${drift}s`)
  if (!sameTitle(spotify, youtube)) facts.push('different title')
  if (!sharesAnArtist(spotify, youtube)) facts.push('no artist in common')
  return `no match: ${facts.length > 0 ? facts.join(', ') : 'a different version'}`
}

/** The same title, exactly or once credits and decoration are set aside. */
function sameTitle(spotify, youtube) {
  if (foldTitle(spotify?.name) === foldTitle(youtube?.name)) return true
  const essential = essentialTitle(youtube?.name, new Set(bylineNames(youtube)))
  return essential !== '' && essential === essentialTitle(spotify?.name, new Set(spotifyNames(spotify)))
}
```

- [ ] **Step 4: Write `rankResults`**

In `src/match/findTwin.js`, change `import { queryTitle, scorePair } from './scorePair.js'` to `import { explainPair, queryTitle, scorePair } from './scorePair.js'`, and append to the end of the file:

```js
/**
 * Search results for one song, as the match tray lists them (design §4): what
 * the matcher accepts first, surest then nearest in length, then the rest in
 * search order. Each carries the matcher's verdict in words, and whether it is
 * already in the other playlist.
 *
 * @param {object} song the song being matched
 * @param {Array} results Tracks from the other service
 * @param {{side: 'youtube'|'spotify', inOtherPlaylist?: (track: object) => boolean}} options
 *   side names the service the results come from
 * @returns {Array<{track: object, verdict: string, accepted: boolean, already: boolean}>}
 */
export function rankResults(song, results, { side, inOtherPlaylist = () => false }) {
  const rows = results.map((track, index) => {
    const [spotify, youtube] = side === 'youtube' ? [song, track] : [track, song]
    return { track, index, scored: scorePair(spotify, youtube), verdict: explainPair(spotify, youtube) }
  })
  rows.sort(
    (a, b) =>
      (TIER_RANK[b.scored?.tier] ?? 0) - (TIER_RANK[a.scored?.tier] ?? 0) ||
      (a.scored && b.scored ? Math.abs(a.scored.durationDeltaMs) - Math.abs(b.scored.durationDeltaMs) : 0) ||
      a.index - b.index,
  )
  return rows.map(({ track, scored, verdict }) => ({
    track,
    verdict,
    accepted: scored !== null,
    already: inOtherPlaylist(track),
  }))
}
```

- [ ] **Step 5: Write the lookups and `openHref`**

Create `src/services/trackLookups.js`:

```js
/**
 * The match tray's two lookups (docs/2026-10-10-match-tray-design.md §4, §5):
 * the owner's own search of the other catalogue, and the one track a pasted
 * link names. The clients are handed in, so both test without a network.
 */

import { parseTrackLink } from '../match/links.js'
import { getTrack, SEARCH_LIMIT, searchTracks } from './spotify/search.js'
import { normalizeYouTubeSearchResults } from './youtube/track.js'

const NAMES = { youtube: 'YouTube Music', spotify: 'Spotify' }
const NOT_FOUND = 'That track could not be found.'

/**
 * The owner's own search of one catalogue. On YouTube Music it runs songs and
 * videos together and drops a video already listed as a song.
 *
 * @param {'youtube'|'spotify'} side the catalogue to search
 */
export async function searchCatalogue(text, side, { youtube, spotify }) {
  if (side === 'spotify') return searchTracks(spotify, text, SEARCH_LIMIT)
  const [songs, videos] = await Promise.all([youtube.search(text, 'songs', 10), youtube.search(text, 'videos', 5)])
  const seen = new Set()
  return normalizeYouTubeSearchResults([...songs, ...videos]).filter((track) => {
    if (seen.has(track.id)) return false
    seen.add(track.id)
    return true
  })
}

/**
 * The track a pasted link names, or the one line that says why it cannot be
 * paired: not one song, the other service's link, or no such track.
 *
 * @param {'youtube'|'spotify'} side the service the link must be from
 * @returns {Promise<{track: object}|{error: string}>}
 */
export async function lookupLink(text, side, { youtube, spotify }) {
  const link = parseTrackLink(text)
  if (!link) return { error: `That isn't a link to one song on ${NAMES[side]}.` }
  if (link.service !== side) {
    const pasted = link.service === 'spotify' ? 'Spotify' : 'YouTube'
    return { error: `That's a ${pasted} link. This song needs a ${NAMES[side]} one.` }
  }
  try {
    const track =
      side === 'youtube'
        ? normalizeYouTubeSearchResults([await youtube.track(link.id)].filter(Boolean))[0]
        : await getTrack(spotify, link.id)
    return track ? { track } : { error: NOT_FOUND }
  } catch (failure) {
    // Spotify answers an unknown or malformed id with 404 or 400.
    return { error: failure?.status === 404 || failure?.status === 400 ? NOT_FOUND : failure.message }
  }
}
```

Append to the end of `src/ui/format.js`:

```js
/**
 * Where ↗ Open sends a track: its page in its own service. None for a local
 * file, which has no page.
 */
export function openHref(track) {
  if (!track?.id) return null
  return track.source === 'youtube'
    ? `https://music.youtube.com/watch?v=${track.id}`
    : `https://open.spotify.com/track/${track.id}`
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/match src/services src/ui/format.test.js`
Expected: PASS.

- [ ] **Step 7: Run the whole suite and the lint**

Run: `npm test` and `npm run lint`.
Expected: 679 tests pass; the lint shows only the two existing warnings.

- [ ] **Step 8: Commit**

```bash
git add src/match/scorePair.js src/match/scorePair.test.js src/match/findTwin.js src/match/findTwin.test.js src/services/trackLookups.js src/services/trackLookups.test.js src/ui/format.js src/ui/format.test.js
git commit -m "Put the matcher's verdict in words, rank results, and look songs up for the tray

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The tray

**Files:**
- Create: `src/ui/screens/MatchTray.jsx`, `src/ui/review.css`
- Modify: `src/ui/screens/Review.jsx` (rewritten in full below)
- Modify: `src/ui/useMatchReview.js` (return the two id sets)
- Modify: `src/main.jsx` (import `review.css`)
- Modify: `src/ui/board.css` (the review board's grid: a wider action column, and the phone grid)

**Interfaces:**
- Consumes: Task 2's `explainPair`, `rankResults`, `searchCatalogue`, `lookupLink` and `openHref`; the existing `queryTitle`, `closestTitles`, `spotifyKeyOf`, `formatDuration`, `QuietLever`, and the hook's `decide`, `undo`, `found` and `sweep`.
- Produces:
  - `MatchTray(props)`, documented in its JSDoc;
  - `useMatchReview` also returns `youtubeIds: Set<string>` and `spotifyKeys: Set<string>`.

There is no component test infrastructure in this repo (Plan A spec §7). The tray's logic is the pure pieces from Tasks 1–2. Task 4's column check and Task 5's walkthrough gate the screen.

- [ ] **Step 1: Write the tray**

Create `src/ui/screens/MatchTray.jsx`:

```jsx
/**
 * The match tray: where one song is matched, opened under its row on the
 * match review. See docs/2026-10-10-match-tray-design.md §3–§6.
 *
 * It holds a player for each side, the owner's own search, a field for a
 * pasted link, and the candidates — search results first, then the other
 * playlist's leftovers — each with Listen, Open and Pair. Read-only: Pair
 * hands the chosen track back to the review, which records the decision.
 */

import { useState } from 'react'
import { rankResults } from '../../match/findTwin.js'
import { explainPair, queryTitle } from '../../match/scorePair.js'
import { lookupLink, searchCatalogue } from '../../services/trackLookups.js'
import { artistsOf, formatDuration, openHref, titleOf } from '../format.js'
import { QuietLever } from '../components/chrome.jsx'

const NAMES = { youtube: 'YouTube Music', spotify: 'Spotify' }

/**
 * @param {object} props
 * @param {object} props.song the playlist song the tray matches
 * @param {'youtube'|'spotify'} props.side the service its candidates come from
 * @param {object} [props.pair] the proposed or settled pair, when a pair row opened it
 * @param {boolean} [props.settled] a settled pair only listens: Undo, then Find a match, picks again
 * @param {Array} props.sweepResults what the sweep found for the song: Tracks from `side`
 * @param {Array} props.leftovers the other playlist's unmatched songs, closest title first
 * @param {(track: object) => boolean} props.inOtherPlaylist
 * @param {{youtube: object, spotify: object}} props.clients
 * @param {boolean} props.deciding false while a sweep runs, when no decision may be made
 * @param {(track: object) => void} props.onPair
 * @param {(verdict: 'same'|'different') => void} props.onDecide
 * @param {() => void} props.onUndo
 * @param {() => void} props.onClose
 */
export function MatchTray({
  song,
  side,
  pair = null,
  settled = false,
  sweepResults,
  leftovers,
  inOtherPlaylist,
  clients,
  deciding,
  onPair,
  onDecide,
  onUndo,
  onClose,
}) {
  const other = NAMES[side]
  const [query, setQuery] = useState(() => startingQuery(song, side))
  const [manual, setManual] = useState(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const [link, setLink] = useState('')
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState(null)
  // The song's own side plays it; the other side plays the pair's track, or
  // whichever result was last listened to. YouTube autoplays only after Listen.
  const [loaded, setLoaded] = useState(() => ({
    spotify: pair?.spotify ?? (side === 'youtube' ? song : null),
    youtube: pair?.youtube ?? (side === 'spotify' ? song : null),
    autoplay: false,
  }))

  const listen = (track) => setLoaded((prev) => ({ ...prev, [side]: track, autoplay: side === 'youtube' }))

  async function search(event) {
    event.preventDefault()
    const text = query.trim()
    if (!text) return
    setSearching(true)
    setSearchError(null)
    try {
      setManual(await searchCatalogue(text, side, clients))
    } catch (failure) {
      setSearchError(`Could not search ${other}: ${failure.message}`)
    } finally {
      setSearching(false)
    }
  }

  async function pairLink(event) {
    event.preventDefault()
    setLinking(true)
    setLinkError(null)
    const { track, error } = await lookupLink(link, side, clients)
    setLinking(false)
    if (error) setLinkError(error)
    else onPair(track)
  }

  const results = rankResults(song, manual ?? sweepResults, { side, inOtherPlaylist })
  const leftoverRows = leftovers.map((track) => ({
    track,
    verdict: side === 'youtube' ? explainPair(song, track) : explainPair(track, song),
    already: false,
  }))
  const list = { playingId: loaded[side]?.id, onListen: listen, onPair, deciding, other }

  return (
    <div className="tray" role="region" aria-label={`Match ${titleOf(song)}`}>
      <div className="tray-players">
        <span className="col-label">Spotify</span>
        <SpotifyPlayer track={loaded.spotify} />
        <span className="col-label">YouTube Music</span>
        <YouTubePlayer track={loaded.youtube} autoplay={loaded.autoplay} />
      </div>

      <div className="tray-work">
        {pair ? (
          <div className="tray-pair">
            <p className="row-sub">The matcher says: {explainPair(pair.spotify, pair.youtube)}</p>
            <div className="tray-actions">
              <OpenLink track={pair.spotify} label="↗ Open in Spotify" />
              <OpenLink track={pair.youtube} label="↗ Open in YouTube Music" />
              <span className="tray-decide">
                {settled ? (
                  <QuietLever className="lever-quiet is-compact" onClick={onUndo} disabled={deciding}>
                    Undo
                  </QuietLever>
                ) : (
                  <>
                    <QuietLever className="lever-quiet is-compact" onClick={() => onDecide('same')} disabled={deciding}>
                      Confirm
                    </QuietLever>
                    <QuietLever className="lever-quiet is-compact" onClick={() => onDecide('different')} disabled={deciding}>
                      Reject
                    </QuietLever>
                  </>
                )}
              </span>
            </div>
          </div>
        ) : null}

        {settled ? null : (
          <>
            {pair ? <p className="col-label">Not this one? Pick another</p> : null}
            <form className="tray-field" onSubmit={search}>
              <input
                className="field"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label={`Search ${other}`}
              />
              <QuietLever type="submit" disabled={searching}>
                {searching ? 'Searching…' : `Search ${other}`}
              </QuietLever>
            </form>
            {searchError ? (
              <p className="row-sub tray-error" role="alert">
                {searchError}
              </p>
            ) : null}
            <form className="tray-field" onSubmit={pairLink}>
              <input
                className="field"
                value={link}
                onChange={(event) => setLink(event.target.value)}
                placeholder={`Or paste a ${other} link`}
                aria-label={`Paste a ${other} link`}
              />
              <QuietLever type="submit" disabled={deciding || linking || !link.trim()}>
                Pair
              </QuietLever>
            </form>
            {linkError ? (
              <p className="row-sub tray-error" role="alert">
                {linkError}
              </p>
            ) : null}
            <CandidateList title="Search results" rows={results} {...list} />
            <CandidateList title={`In your ${other} playlist`} rows={leftoverRows} {...list} />
          </>
        )}

        <div className="tray-foot">
          <QuietLever className="lever-quiet is-compact" onClick={onClose}>
            Close
          </QuietLever>
        </div>
      </div>
    </div>
  )
}

/** What the sweep searched for this song, so the owner edits rather than retypes. */
function startingQuery(song, side) {
  const title = side === 'youtube' ? song.name : queryTitle(song)
  return `${title ?? ''} ${song.primaryArtist?.name ?? ''}`.trim()
}

function CandidateList({ title, rows, playingId, onListen, onPair, deciding, other }) {
  if (rows.length === 0) return null
  return (
    <div className="tray-list" role="list" aria-label={title}>
      <p className="col-label tray-list-title">{title}</p>
      {rows.map(({ track, verdict, already }) => (
        <div className="tray-cand" role="listitem" key={track.id}>
          <span className="cell-stack">
            <span className="row-title">{titleOf(track)}</span>
            <span className="row-sub">{artistsOf(track)}</span>
            <span className="row-sub tray-verdict">
              {already ? `Already in your ${other} playlist · ` : ''}
              {verdict}
            </span>
          </span>
          <span className="row-meta num">{formatDuration(track.durationMs)}</span>
          <span className="tray-actions">
            <QuietLever
              className="lever-quiet is-compact"
              aria-pressed={playingId === track.id}
              onClick={() => onListen(track)}
            >
              {playingId === track.id ? '■ Playing' : '▶ Listen'}
            </QuietLever>
            <OpenLink track={track} label="↗ Open" />
            <QuietLever className="lever-quiet is-compact" onClick={() => onPair(track)} disabled={deciding}>
              Pair
            </QuietLever>
          </span>
        </div>
      ))}
    </div>
  )
}

function OpenLink({ track, label }) {
  const href = openHref(track)
  return href ? (
    <a className="lever-quiet is-compact" href={href} target="_blank" rel="noreferrer">
      {label}
    </a>
  ) : null
}

function SpotifyPlayer({ track }) {
  if (!track) return <div className="tray-player tray-player-spotify is-empty">Listen to a result to hear it here</div>
  if (!track.id) return <div className="tray-player tray-player-spotify is-empty">A local file can't play here.</div>
  return (
    <iframe
      key={track.id}
      className="tray-player tray-player-spotify"
      title={`Spotify player: ${titleOf(track)}`}
      src={`https://open.spotify.com/embed/track/${track.id}`}
      allow="encrypted-media"
    />
  )
}

function YouTubePlayer({ track, autoplay }) {
  if (!track?.id) return <div className="tray-player tray-player-youtube is-empty">Listen to a result to hear it here</div>
  return (
    <iframe
      key={track.id}
      className="tray-player tray-player-youtube"
      title={`YouTube player: ${titleOf(track)}`}
      src={`https://www.youtube-nocookie.com/embed/${track.id}${autoplay ? '?autoplay=1' : ''}`}
      allow="autoplay; encrypted-media"
      allowFullScreen
    />
  )
}
```

- [ ] **Step 2: Style it**

Create `src/ui/review.css`:

```css
/* ---- Match tray (docs/2026-10-10-match-tray-design.md) ---------------- */

/* Opens under its row, across the board's full width. */
.tray {
  display: grid;
  grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
  border-top: 2px solid var(--rule);
  border-bottom: 2px solid var(--rule);
  background: var(--board-deep);
}

.tray-players {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px clamp(10px, 1.4vw, 18px);
  border-right: 1px solid var(--rule-soft);
}

/* The services' own players, seated in a well. */
.tray-player {
  display: block;
  width: 100%;
  border: 1px solid var(--rule);
  background: var(--seam);
}

.tray-player-spotify {
  height: 80px;
}

/* YouTube's embedded player must be at least 200×200px. */
.tray-player-youtube {
  aspect-ratio: 16 / 9;
  min-height: 200px;
}

.tray-player.is-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
  color: var(--flap-faint);
  font-size: var(--fs-sub);
  text-align: center;
}

.tray-work {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 14px clamp(10px, 1.4vw, 18px);
}

.tray-field {
  display: flex;
  gap: 8px;
}

.tray-field .field {
  flex: 1;
  min-width: 0;
}

.tray-error {
  color: var(--red);
}

.tray-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  justify-content: flex-end;
}

.tray-pair .tray-actions {
  justify-content: flex-start;
  margin-top: 8px;
}

/* A link that opens the other service is board furniture too: a quiet lever. */
a.lever-quiet {
  display: inline-block;
  text-decoration: none;
}

/* D36: one grid per list. Its rows lie on it as subgrid, so every row's
   columns line up and the action column is as wide as its widest buttons. */
.tray-list {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content max-content;
  border: 1px solid var(--rule);
}

.tray-list-title {
  grid-column: 1 / -1;
  padding: 8px 10px;
  border-bottom: 1px solid var(--rule);
}

.tray-cand {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: subgrid;
  background: linear-gradient(180deg, var(--board-lit) 0 50%, var(--board) 50% 100%);
  border-bottom: 1px solid var(--seam);
}

.tray-cand:last-child {
  border-bottom: 0;
}

.tray-cand > * {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  padding: 7px 10px;
}

.tray-cand > * + * {
  border-left: 1px solid var(--rule-soft);
}

.tray-cand > .tray-actions {
  flex-direction: row;
}

/* The verdict is a sentence, and the reason to read the row: it wraps rather
   than being cut off. */
.tray-verdict {
  white-space: normal;
}

.tray-foot {
  display: flex;
  justify-content: flex-end;
}

/* Confirm, Reject and Undo sit on the row, and in the tray only on a phone (D35). */
.row-decide {
  display: contents;
}

.tray-decide {
  display: none;
}

@media (max-width: 680px) {
  .tray {
    grid-template-columns: minmax(0, 1fr);
  }

  .tray-players {
    border-right: 0;
    border-bottom: 1px solid var(--rule-soft);
  }

  /* The box keeps the full width; its lever drops beneath it. */
  .tray-field {
    flex-wrap: wrap;
  }

  .tray-field .field {
    flex-basis: 100%;
  }

  .tray-list {
    grid-template-columns: minmax(0, 1fr) max-content;
  }

  .tray-cand > .tray-actions {
    grid-column: 1 / -1;
    justify-content: flex-start;
    border-left: 0;
    border-top: 1px solid var(--rule-soft);
  }

  .row-decide {
    display: none;
  }

  .tray-decide {
    display: flex;
    gap: 6px;
  }
}
```

In `src/main.jsx`, add `import './ui/review.css'` on the line after `import './ui/board.css'`.

- [ ] **Step 3: Rewrite the review screen**

Replace the whole of `src/ui/screens/Review.jsx` with the code below. Everything else on the screen is unchanged: the playlist choice, the busy meter, the notices, the sweep's progress and Stop, the group order, and Confirm all strong. What changes:
- **The dropdown is gone.** Unmatched rows have **Find a match**; pair rows have **Listen**.
- **One tray at a time** opens beneath its row.
- **↗ Open** replaces Play.
- **A settled row's reason** gives the matcher's verdict.
- **Row levers:** Confirm, Reject and Undo sit in a `row-decide` span, which a phone hides (the tray carries them there).
- **The length cells** carry `col-length`, so a phone can hide them.

```jsx
/**
 * Match review: which Spotify track is which YouTube track.
 *
 * Read-only. Decisions go to the match book; nothing is written to Spotify or
 * YouTube. Likely rows warm amber (pending) and settled rows take the green
 * seat (committed), reusing the board's data-moves and data-written states.
 * "Search all unmatched" looks for the leftovers' twins in the other
 * service's catalogue, and every row opens a tray beneath it where one song
 * is matched by hand. See docs/2026-10-05-match-review-design.md §3,
 * docs/2026-10-08-catalogue-search-design.md §6 and
 * docs/2026-10-10-match-tray-design.md.
 */

import { useState } from 'react'
import { spotifyKeyOf } from '../../match/matchBook.js'
import { closestTitles } from '../../match/pairTracks.js'
import { explainPair } from '../../match/scorePair.js'
import { artistsOf, formatCount, formatDelta, openHref, titleOf } from '../format.js'
import { useMatchReview } from '../useMatchReview.js'
import { Frame, Head, Lever, LeverRow, Meter, Notice, QuietLever } from '../components/chrome.jsx'
import { UnlitField } from '../components/UnlitField.jsx'
import { MatchTray } from './MatchTray.jsx'

export function ReviewScreen({ app }) {
  const { playlist, tracks, youtube, client, setScreen } = app
  const review = useMatchReview({ youtube, spotify: client, spotifyTracks: tracks })
  const { result, sweep } = review
  const [openKey, setOpenKey] = useState(null)
  const tier = (name) => result?.pairs.filter((pair) => pair.tier === name) ?? []
  const likely = tier('likely')
  const strong = tier('strong')
  const settled = tier('certain')
  // M-1: a row can move mid-decision while a sweep lands results, so deciding
  // waits until it ends or is stopped.
  const deciding = sweep?.running === true

  const toggle = (key) => setOpenKey((open) => (open === key ? null : key))
  const close = () => setOpenKey(null)
  const clients = { youtube, spotify: client }

  /** Everything the tray needs to match one playlist song. */
  const trayFor = (song, side, extra = {}) => {
    const onYoutube = side === 'spotify'
    return (
      <MatchTray
        song={song}
        side={side}
        sweepResults={searchOptionsOf(
          onYoutube ? review.found.forYoutube.get(song.id) : review.found.forSpotify.get(spotifyKeyOf(song)),
          side,
        )}
        leftovers={closestTitles(song, onYoutube ? result.unmatchedSpotify : result.unmatchedYoutube)}
        inOtherPlaylist={(track) =>
          onYoutube ? review.spotifyKeys.has(spotifyKeyOf(track)) : review.youtubeIds.has(track.id)
        }
        clients={clients}
        deciding={deciding}
        onPair={(chosen) => {
          if (onYoutube) review.decide(chosen, song, 'same')
          else review.decide(song, chosen, 'same')
          close()
        }}
        onClose={close}
        {...extra}
      />
    )
  }

  /** A pair's tray matches its playlist-side song: the YouTube one for a Spotify find. */
  const pairTray = (pair, state) =>
    trayFor(pair.missingFrom === 'spotify' ? pair.youtube : pair.spotify, pair.missingFrom === 'spotify' ? 'spotify' : 'youtube', {
      pair,
      settled: state === 'settled',
      onDecide: (verdict) => {
        review.decide(pair.spotify, pair.youtube, verdict)
        close()
      },
      onUndo: () => {
        review.undo(pair)
        close()
      },
    })

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
                <span className="num">{formatCount(sweep.failed)}</span> search{sweep.failed === 1 ? '' : 'es'} failed
              </>
            ) : null}
          </p>
          <Meter done={sweep.done} total={sweep.total} />
          {sweep.running ? (
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
              <QuietLever className="lever-quiet is-compact" onClick={review.stopSearch}>
                Stop
              </QuietLever>
              <span className="row-sub">
                Deciding waits until the search ends or is stopped, so no row moves under the pointer.
              </span>
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
            <span className="col-label col-length">Length</span>
            <span className="col-label col-why">Why</span>
            <span className="col-label" />
          </div>

          <div className="board-scroll" role="table" aria-label="Matches">
            <GroupHeading count={likely.length}>Likely — check each one</GroupHeading>
            {likely.map((pair) => {
              const key = `l${rowKey(pair)}`
              return (
                <PairBlock key={key} pair={pair} state="pending" open={openKey === key} tray={() => pairTray(pair, 'pending')}>
                  <TrayToggle open={openKey === key} onClick={() => toggle(key)} label="Listen" />
                  <DecisionLevers pair={pair} review={review} disabled={deciding} />
                </PairBlock>
              )
            })}

            <GroupHeading count={strong.length}>Strong</GroupHeading>
            {strong.map((pair) => {
              const key = `s${rowKey(pair)}`
              return (
                <PairBlock key={key} pair={pair} open={openKey === key} tray={() => pairTray(pair, 'strong')}>
                  <TrayToggle open={openKey === key} onClick={() => toggle(key)} label="Listen" />
                  <DecisionLevers pair={pair} review={review} disabled={deciding} />
                </PairBlock>
              )
            })}

            <GroupHeading count={result.unmatchedSpotify.length}>Only on Spotify</GroupHeading>
            {result.unmatchedSpotify.map((track) => {
              const key = `o${track.originalIndex}`
              return (
                <UnmatchedBlock
                  key={key}
                  track={track}
                  side="spotify"
                  open={openKey === key}
                  onToggle={() => toggle(key)}
                  tray={() => trayFor(track, 'youtube')}
                />
              )
            })}

            <GroupHeading count={result.unmatchedYoutube.length}>Only on YouTube</GroupHeading>
            {result.unmatchedYoutube.map((track) => {
              const key = `y${track.originalIndex}`
              return (
                <UnmatchedBlock
                  key={key}
                  track={track}
                  side="youtube"
                  open={openKey === key}
                  onToggle={() => toggle(key)}
                  tray={() => trayFor(track, 'spotify')}
                />
              )
            })}

            <details className="review-settled">
              <summary className="review-group col-label">
                Settled (<span className="num">{formatCount(settled.length)}</span>)
              </summary>
              {settled.map((pair) => {
                const key = `c${rowKey(pair)}`
                return (
                  <PairBlock key={key} pair={pair} state="settled" open={openKey === key} tray={() => pairTray(pair, 'settled')}>
                    <TrayToggle open={openKey === key} onClick={() => toggle(key)} label="Listen" />
                    <span className="row-decide">
                      <QuietLever className="lever-quiet is-compact" onClick={() => review.undo(pair)} disabled={deciding}>
                        Undo
                      </QuietLever>
                    </span>
                  </PairBlock>
                )
              })}
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
        <Lever disabled={strong.length === 0 || deciding} onClick={() => review.confirmAll(strong)}>
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

/** Everything the sweep turned up for one song, accepted first. */
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

function TrayToggle({ open, onClick, label }) {
  return (
    <QuietLever className="lever-quiet is-compact" aria-expanded={open} onClick={onClick}>
      {open ? 'Close' : label}
    </QuietLever>
  )
}

function DecisionLevers({ pair, review, disabled }) {
  return (
    <span className="row-decide">
      <QuietLever
        className="lever-quiet is-compact"
        onClick={() => review.decide(pair.spotify, pair.youtube, 'same')}
        disabled={disabled}
      >
        Confirm
      </QuietLever>
      <QuietLever
        className="lever-quiet is-compact"
        onClick={() => review.decide(pair.spotify, pair.youtube, 'different')}
        disabled={disabled}
      >
        Reject
      </QuietLever>
    </span>
  )
}

/** A pair row, and its tray beneath it when open. */
function PairBlock({ pair, state, open, tray, children }) {
  // §7: a settled row says what the matcher thinks, so a wrong pick stands out.
  const reason = state === 'settled' ? `You confirmed this · the matcher says: ${explainPair(pair.spotify, pair.youtube)}` : pair.reason
  return (
    <>
      <div
        className="board-row"
        role="row"
        data-moves={state === 'pending' ? 'true' : undefined}
        data-written={state === 'settled' ? 'true' : undefined}
      >
        <TrackCell track={pair.spotify} note={pair.missingFrom === 'spotify' ? 'Not in your Spotify playlist' : null} />
        <TrackCell track={pair.youtube} note={pair.missingFrom === 'youtube' ? 'Not in your YouTube playlist' : null} />
        <span className="cell-end col-length" role="cell">
          <span className="row-meta num">{formatDelta(pair.durationDeltaMs)}</span>
        </span>
        <span className="row-sub col-why" role="cell">
          {reason}
        </span>
        <span className="cell-end review-levers" role="cell">
          {children}
        </span>
      </div>
      {open ? tray() : null}
    </>
  )
}

/** An unmatched song, its Find a match lever, and its tray beneath it when open. */
function UnmatchedBlock({ track, side, open, onToggle, tray }) {
  const own = <TrackCell track={track} />
  const none = (
    <span className="row-sub" role="cell">
      No match yet
    </span>
  )
  return (
    <>
      <div className="board-row" role="row">
        {side === 'spotify' ? own : none}
        {side === 'spotify' ? none : own}
        <span role="cell" className="col-length" />
        <span role="cell" className="col-why" />
        <span className="cell-end review-levers" role="cell">
          <TrayToggle open={open} onClick={onToggle} label="Find a match" />
        </span>
      </div>
      {open ? tray() : null}
    </>
  )
}

function TrackCell({ track, note = null }) {
  const href = openHref(track)
  return (
    <span className="cell-stack" role="cell">
      <span className="row-title">{titleOf(track)}</span>
      <span className="row-sub row-sub-links">
        <span className="row-sub-text">{artistsOf(track)}</span>
        {href ? (
          <>
            ·
            <a className="row-play" href={href} target="_blank" rel="noreferrer">
              ↗ Open
            </a>
          </>
        ) : null}
      </span>
      {note ? <span className="row-sub">{note}</span> : null}
    </span>
  )
}
```

- [ ] **Step 4: Expose the id sets, and widen the review grid**

In `src/ui/useMatchReview.js`, in the returned object, add two lines after `unsearchedCount: unsearched.spotify.length + unsearched.youtube.length,`:

```js
    youtubeIds,
    spotifyKeys,
```

(Both already exist in the hook as `useMemo` sets.)

In `src/ui/board.css`, in the "Match review board" section:

(a) In the first `.board-review` rule, change `--cols: minmax(0, 1fr) minmax(0, 1fr) 9ch minmax(0, 0.8fr) 24ch;` to:

```css
  --cols: minmax(0, 1fr) minmax(0, 1fr) 9ch minmax(0, 0.8fr) 37ch;
```

(37ch holds Listen, Confirm and Reject. The layout check measured 34ch overflowing by up to 16px.)

(b) Replace the phone block's two rules:

```css
  .board-review {
    --cols: minmax(0, 1fr) minmax(0, 1fr) 7ch 20ch;
  }

  .board-review .col-why {
    display: none;
  }
```

with:

```css
  .board-review {
    --cols: minmax(0, 1fr) minmax(0, 1fr) 15ch;
  }

  .board-review .col-length,
  .board-review .col-why {
    display: none;
  }
```

- [ ] **Step 5: Verify**

Run: `npm test`, `npm run lint` and `npm run build`.
Expected: 679 tests pass; the lint shows only the two existing warnings; the build is clean.

- [ ] **Step 6: Commit**

```bash
git add src/ui/screens/MatchTray.jsx src/ui/review.css src/ui/screens/Review.jsx src/ui/useMatchReview.js src/main.jsx src/ui/board.css
git commit -m "Match each song in a tray under its row: search, paste a link, listen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The column check

**Files:**
- Create: `scripts/check-columns.js`
- Modify: `src/ui/board.css` (the Playlists board's access column)

**Interfaces:**
- Consumes: the app in demo mode (`/?demo=1…`, `src/ui/demoData.js`'s `loadDemo`), Task 3's tray (its **Find a match**, **Listen** and **Close** levers, and the `.tray`, `.tray-cand`, `.tray-field` classes).
- Produces: a script that returns `"{}"` when nothing spills, and otherwise each finding with the screens and widths it was seen at.

- [ ] **Step 1: Write the check**

Create `scripts/check-columns.js`:

```js
// The layout check (docs/2026-10-10-match-tray-design.md §10): opens every
// screen in demo mode at six widths and reports any element that runs past
// its column or its row. It must report {}.
//
// With the dev server running (`npm run dev:web`), from the repo root:
//   playwright-cli open about:blank
//   playwright-cli --raw run-code --filename=scripts/check-columns.js
//
// It uses no one's library: the match review is fed synthetic long titles and
// artists through a mocked proxy, and every request that would leave the
// machine (Spotify, YouTube's and Spotify's players) is answered locally.
async (page) => {
  const BASE = 'http://127.0.0.1:5173'
  const WIDTHS = [1440, 1280, 1024, 860, 680, 390]
  const LONG = 'An Extraordinarily Long Song Title That Keeps Going (Official Music Video) | Feat. Many Guests | 2026'
  const LONG_ARTISTS = ['A Very Long Artist Name', 'Another Rather Long Artist Name', 'A Third Featured Artist']

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${BASE}/?demo=1`)
  const demo = await page.evaluate(async () => {
    const module = await import('/src/ui/demoData.js')
    return module
      .loadDemo()
      .tracks.filter((track) => track.id)
      .map((track) => ({ id: track.id, name: track.name, artist: track.primaryArtist.name, seconds: Math.round(track.durationMs / 1000) }))
  })

  const raw = (videoId, title, artists, seconds, videoType = 'MUSIC_VIDEO_TYPE_ATV') => ({
    videoId,
    setVideoId: `set-${videoId}`,
    title,
    artists: artists.map((name) => ({ name, id: null })),
    album: videoType === 'MUSIC_VIDEO_TYPE_ATV' ? { name: 'An Album', id: null } : null,
    duration_seconds: seconds,
    videoType,
  })
  const longRaw = (videoId) => raw(videoId, `${LONG} ${videoId}`, LONG_ARTISTS, 241, 'MUSIC_VIDEO_TYPE_OMV')
  // Four exact twins (strong), two 4s off (likely), six long unmatched rows.
  const library = [
    ...demo.slice(0, 4).map((track, index) => raw(`strong${index}0000`.slice(0, 11), track.name, [track.artist], track.seconds)),
    ...demo.slice(4, 6).map((track, index) => raw(`likely${index}0000`.slice(0, 11), track.name, [track.artist], track.seconds + 4)),
    ...Array.from({ length: 6 }, (_, index) => longRaw(`longvid${index}000`.slice(0, 11))),
  ]
  // Songs the sweep finds in the catalogue: the next four demo tracks.
  const catalogue = new Map(demo.slice(6, 10).map((track, index) => [`${track.name} ${track.artist}`, raw(`found${index}00000`.slice(0, 11), track.name, [track.artist], track.seconds)]))
  const spotifyLong = (id) => ({
    id,
    uri: `spotify:track:${id}`,
    type: 'track',
    name: `${LONG} ${id}`,
    duration_ms: 241000,
    artists: LONG_ARTISTS.map((name) => ({ id: name, name })),
    album: { id: 'al', name: 'An Album', release_date: '2026-01-01', release_date_precision: 'day' },
  })

  await page.route('http://127.0.0.1:8787/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/playlists') {
      return route.fulfill({ json: { playlists: [{ id: 'PLT', title: 'test punjabi songs', count: library.length }] } })
    }
    if (url.pathname.startsWith('/playlists/')) {
      return route.fulfill({ json: { id: 'PLT', title: 'test punjabi songs', counted: library.length, readable: library.length, tracks: library } })
    }
    if (url.pathname === '/search') {
      const found = catalogue.get(url.searchParams.get('q'))
      return route.fulfill({ json: { results: found ? [found] : [longRaw('nearmiss000'), longRaw('nearmiss001')] } })
    }
    if (url.pathname.startsWith('/track/')) return route.fulfill({ json: { track: longRaw('pasted00000') } })
    return route.fulfill({ json: { authenticated: true } })
  })
  await page.route('https://api.spotify.com/**', (route) =>
    route.fulfill({ json: route.request().url().includes('/search') ? { tracks: { items: [spotifyLong('spotifyLong01234567890')] } } : spotifyLong('spotifyLong01234567890') }),
  )
  for (const host of ['https://open.spotify.com/**', 'https://www.youtube-nocookie.com/**']) {
    await page.route(host, (route) => route.fulfill({ contentType: 'text/html', body: '<html></html>' }))
  }

  const measure = () => {
    const found = []
    const rows = document.querySelectorAll(
      '.board-row, .board-cols, .lever-row, .head, .tally, .peek-row, .tray-cand, .tray-field, .tray-pair .tray-actions, .tray-foot',
    )
    for (const row of rows) {
      const rowBox = row.getBoundingClientRect()
      if (rowBox.width === 0) continue
      const name = `${row.className.split(' ')[0]}${row.closest('.board')?.classList.contains('board-review') ? '@review' : ''}`
      for (const [index, cell] of [...row.children].entries()) {
        const cellBox = cell.getBoundingClientRect()
        if (cellBox.width === 0 || cellBox.height === 0) continue
        if (cellBox.right > rowBox.right + 1.5 || cellBox.left < rowBox.left - 1.5) {
          found.push(`${name} cell ${index} runs past its row by ${Math.round(Math.max(cellBox.right - rowBox.right, rowBox.left - cellBox.left))}px`)
        }
        const style = getComputedStyle(cell)
        if (style.overflowX === 'visible' && cell.scrollWidth > cell.clientWidth + 1) {
          found.push(`${name} cell ${index} text runs past its column: "${cell.textContent.trim().slice(0, 40)}"`)
        }
        for (const element of cell.querySelectorAll('*')) {
          const box = element.getBoundingClientRect()
          if (box.width === 0 || box.height === 0) continue
          const over = Math.max(box.right - cellBox.right, cellBox.left - box.left)
          if (over > 1.5) found.push(`${name} cell ${index} ${element.tagName.toLowerCase()} "${(element.textContent || '').trim().slice(0, 30)}" runs past its column by ${Math.round(over)}px`)
        }
      }
    }
    return [...new Set(found)]
  }

  const report = {}
  const note = (where, findings) => {
    for (const finding of findings) (report[finding] ??= []).push(where)
  }
  const screens = [
    ['playlists', '/?demo=1'],
    ['sort', '/?demo=1&screen=sort'],
    ['sort-csv', '/?demo=1&screen=sort&csv=1'],
    ['preview', '/?demo=1&screen=preview&playlist=2'],
    ['progress', '/?demo=1&screen=progress&playlist=2&progress=running'],
    ['progress-done', '/?demo=1&screen=progress&progress=done'],
    ['review', '/?demo=1&screen=review'],
  ]
  for (const [name, path] of screens) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      // One settled pair, so the Settled group has a row to measure.
      await page.evaluate(
        ([key]) =>
          localStorage.setItem('playlist-sorter:match-book', JSON.stringify([{ spotifyKey: key, youtubeVideoId: 'strong00000', verdict: 'same', decidedAt: 1 }])),
        [demo[0].id],
      )
      await page.goto(`${BASE}${path}`)
      await page.waitForTimeout(500)
      if (name !== 'review') {
        note(`${name}@${width}`, await page.evaluate(measure))
        continue
      }
      await page.selectOption('#review-youtube', 'PLT')
      await page.waitForSelector('.board-review .board-row')
      await page.getByRole('button', { name: 'Search all unmatched' }).click()
      await page.waitForFunction(() => document.body.textContent.includes('Searched'), null, { timeout: 30000 })
      await page.locator('.review-settled > summary').click()
      note(`review@${width}`, await page.evaluate(measure))
      for (const [label, button] of [
        ['tray: only on Spotify', page.getByRole('button', { name: 'Find a match' }).first()],
        ['tray: a likely pair', page.getByRole('button', { name: 'Listen', exact: true }).first()],
        ['tray: only on YouTube', page.getByRole('button', { name: 'Find a match' }).last()],
      ]) {
        await button.click()
        await page.waitForSelector('.tray')
        note(`${label}@${width}`, await page.evaluate(measure))
        await page.getByRole('button', { name: 'Close', exact: true }).first().click()
      }
    }
  }
  return JSON.stringify(report, null, 1)
}
```

- [ ] **Step 2: Run it and see the one known spill**

Make sure the dev server is serving this working tree on port 5173: `npm run dev:web`, or the owner's running `npm start`, which reloads as files change. Then, from the repo root:

```bash
playwright-cli -s=columns open about:blank
playwright-cli -s=columns --raw run-code --filename=scripts/check-columns.js
```

Expected: one finding, on the Playlists board. Its "Clone only" chip runs past its column, by up to about 9px at 860–1440px wide, as `board-row cell 4 span "Clone only" runs past its column by …px`. This spill is already on today's board.

- [ ] **Step 3: Widen the Playlists board's access column**

In `src/ui/board.css`, in the first `.board-playlists` rule (outside any media query), change `--cols: 64px minmax(0, 1fr) 14ch 7ch 13ch;` to:

```css
  --cols: 64px minmax(0, 1fr) 14ch 7ch 15ch;
```

- [ ] **Step 4: Run it again**

Run: `playwright-cli -s=columns --raw run-code --filename=scripts/check-columns.js`
Expected: `"{}"`. Then `playwright-cli -s=columns close`.

If anything else is reported, stop and report it with the exact output. Do not widen a column the plan does not name.

- [ ] **Step 5: Run the whole suite, the lint and the build**

Run: `npm test`, `npm run lint` and `npm run build`.
Expected: 679 tests pass; the lint shows only the two existing warnings; the build is clean.

- [ ] **Step 6: Commit**

```bash
git add scripts/check-columns.js src/ui/board.css
git commit -m "Check every screen for columns that spill, and widen the access column

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The walkthrough gate, then the record

This repo has no component test infrastructure, so the walkthrough is the gate for the tray. It also gates Plan A and Plan B, whose walkthroughs have not yet been run on the test profiles. **The owner runs it in the browser, on "test punjabi songs".** The controller prepares it, hands it over, and waits.

**Files:**
- Modify: `docs/STATUS.md` (the 2b section)
- Modify: `docs/2026-09-18-youtube-mirror-design.md` (§8: export and import are deferred)
- Modify: `docs/2026-10-05-match-review-design.md` (D24 and D25 are superseded)

- [ ] **Step 1: Prepare**

1. Run `npm test`, `python -m pytest proxy`, `npm run lint`, `npm run build` and the column check. All must pass.
2. Confirm the proxy holds a live session for the YouTube **test** profile: with `npm start` running, `curl -s -X POST http://127.0.0.1:8787/auth/status` must answer `{"authenticated":true}`. If it does not, the owner refreshes `proxy/browser.json` from a private window signed in to the test profile (see `proxy/README.md`).
3. The owner signs in to the app with the Spotify **test** profile. That account must be on the Spotify app's user list in its developer dashboard.

- [ ] **Step 2: The owner's walkthrough**

With `npm start` running, at http://127.0.0.1:5173, signed in with the test profiles.

**Part 1: the match review**

1. Open the Spotify playlist **test punjabi songs**. On its Sort screen, **Match to YouTube** shows in the lever row. Click it: the review screen opens with the dropdown and no board.
2. Choose **test punjabi songs** from the dropdown.
   - The meter shows "Reading the YouTube playlist", then "Matching", then the board.
   - The header counts Strong, Likely, Settled, Only Spotify and Only YouTube.
3. **Confirm** one Likely pair. It moves to Settled, green, and its reason reads "You confirmed this · the matcher says: …".
4. **Reject** one Strong pair. Its Spotify song re-pairs with another track or drops to Only on Spotify.
5. Expand Settled and **Undo** one pair. It returns to its group. Then click **Confirm all … strong**: Strong goes to 0.
6. **Reload the page,** reopen the review and choose the playlist again. Every decision from steps 3–5 is still settled.
7. Double-click **Confirm** on a Likely row. Exactly one pair settles.

**Part 2: searching the catalogues**

8. Click **Search all unmatched**.
   - "Searching N of M" shows with a meter and **Stop**.
   - Finds land in Strong and Likely, marked "Not in your YouTube playlist" or "Not in your Spotify playlist".
9. **While it runs,** Confirm, Reject, Undo, Confirm all and every tray's Pair are greyed out, with the note saying deciding waits. They come back when it ends.
10. Start a search and press **Stop**. Pressing **Search all unmatched** again carries on with only the songs not yet searched.
11. Confirm a find, reload, and reopen the review. It is still settled with its marker, before any search.

**Part 3: the tray**

12. On an **Only on Spotify** row, click **Find a match**. A tray opens under the row.
    - It shows a Spotify player playing the song, an empty YouTube player, and a search box filled with the song's title and artist.
    - Below are the search results, if the sweep found any, and "In your YouTube Music playlist" with the leftovers. Each carries a verdict.
13. Click **▶ Listen** on a result. The YouTube player loads it and starts, and the button reads **■ Playing**. Click **↗ Open**: YouTube Music opens on it in a new tab.
14. Edit the search box and press **Search YouTube Music**. The results are replaced; the ones the matcher accepts come first.
15. **Pair** one. The tray closes and the pair is under Settled, its reason giving the matcher's verdict.
16. On another unmatched Spotify row, paste a **YouTube Music link** to the right song and press **Pair**. It settles.
17. In a tray, paste a **Spotify link** into the YouTube field. It says "That's a Spotify link. This song needs a YouTube Music one." and pairs nothing.
18. Paste `https://youtu.be/aaaaaaaaaaa`. It says "That track could not be found."
19. On an **Only on YouTube** row, click **Find a match**. The YouTube player plays the video and the search box holds its title read past decoration. Paste a **Spotify link** to the right song and **Pair**. It settles.
20. On a **Likely** row, click **Listen**.
    - Both players load, and "The matcher says: …" is shown, with **↗ Open in Spotify** and **↗ Open in YouTube Music**.
    - Under "Not this one? Pick another", pair a different result. The proposal is replaced.
21. On a **Settled** row, click **Listen**. Both play. There is no search or link field.
22. Pair a song with something the matcher would refuse, e.g. by link. Its settled reason reads "…the matcher says: no match: …", so the wrong pick stands out. Undo it.
23. Opening a second row's tray closes the first. **Close** works on both the row and the tray.
24. At 680px wide or less:
    - Rows show only the two track columns and one lever.
    - A Likely or Strong row's tray carries **Confirm** and **Reject**.
    - The tray stacks: players on top, then the search, the link field and the results, each result's levers on their own line.
25. Start a sweep and open a tray. Listening and searching work; Pair is greyed out until the sweep ends.

If any step differs, stop, report it to the controller, and fix it before going on.

- [ ] **Step 3: Record it**

In `docs/STATUS.md`, add to the end of the "YouTube Music: 2b matcher, audited" section. Replace `DD` with the date the walkthrough passed.

```markdown
### Match review, catalogue search and the match tray — done 2026-10-DD

A Spotify playlist's Sort screen opens a review against a YouTube Music
playlist. Pairs are proposed as strong or likely, and settled pairs are kept
in the match book (`localStorage`, `playlist-sorter:match-book`), so a reload
keeps them. **Search all unmatched** looks for every unmatched song's twin in
the other service's catalogue, ISRC first towards YouTube, and proposes what
`scorePair` accepts (spec:
[2026-10-08-catalogue-search-design.md](2026-10-08-catalogue-search-design.md)).
Every row opens a tray beneath it. There the owner hears both sides, opens
either in its own service, searches in their own words, or pastes a Spotify
or YouTube Music link to pair (spec:
[2026-10-10-match-tray-design.md](2026-10-10-match-tray-design.md)).

Read-only: nothing is written to either service. `scripts/check-columns.js`
checks every screen for spilling columns at six widths. Walkthrough passed
by the owner on "test punjabi songs" on the test profiles.
```

In `docs/2026-09-18-youtube-mirror-design.md` §8, after the sentence ending "so it survives a cleared browser.", add the line:

```markdown
*Deferred (2026-10-05): export and import wait until the book holds real work; see the match review design §8.*
```

In `docs/2026-10-05-match-review-design.md` §2:
- At the end of the D24 row's last cell (after `Plan B`), append ` — superseded by D27 (catalogue search design, 2026-10-08)`.
- At the end of the D25 row's last cell, append ` — its dropdown superseded by D31 (match tray design, 2026-10-10)`.

- [ ] **Step 4: Commit**

```bash
git add docs/STATUS.md docs/2026-09-18-youtube-mirror-design.md docs/2026-10-05-match-review-design.md
git commit -m "Record the match review, catalogue search and match tray as done

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
