# YouTube Music Read Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch a YouTube Music playlist as normalized `Track` objects, through a local Python proxy, so the existing sort and plan layers can operate on it unchanged.

**Architecture:** YouTube Music sends no CORS headers, so a browser cannot call it and a local process is required whatever language it is written in. A small FastAPI proxy bound to `127.0.0.1` wraps `ytmusicapi`, holds the session credentials, and exposes read-only JSON. The browser talks only to that proxy. The proxy holds **no business logic** — auth and transport only — so every decision stays in JavaScript where the test suite lives.

**Tech Stack:** React 19, Vite 8, JavaScript (ES modules, **not** TypeScript), Vitest, Oxlint, Node v24.11.1. Python 3.13.14 + FastAPI + uvicorn + ytmusicapi for the proxy, tested with pytest.

**Spec:** [`docs/2026-09-18-youtube-mirror-design.md`](../../2026-09-18-youtube-mirror-design.md) — §4 (service boundary), §5 (the proxy), §6 (Track model), D12, D13, D22.

## Global Constraints

- **`src/` is JavaScript, not TypeScript.** No `.ts` files, no type annotations. JSDoc only.
- **The proxy holds no business logic** (D13). It authenticates and translates. It does not sort, match, rank, decide order, or batch. Any conditional beyond auth/shape-mapping belongs in JS.
- **`ytmusicapi` is pinned to `==1.12.3`.** Browser auth is labelled deprecated upstream (D22); an unpinned upgrade could remove it underneath a working install.
- **`browser.json` is never committed** and never served to the browser. It carries session cookies — full account access.
- **The proxy binds `127.0.0.1` only**, never `0.0.0.0`, and CORS is locked to `http://127.0.0.1:5173`.
- **`npm test` must pass — 300 tests at the start of this plan.** `npm run lint` must be clean (two pre-existing warnings in `Flap.jsx` and `useAuth.js` are expected and not yours to fix).
- **Pure layers stay pure.** `src/model/`, `src/sort/`, `src/csv/`, `src/plan/` must not import anything performing network I/O.
- **Always pass `limit=None`** to `get_playlist`. Measured: the default returned 200 of 379 tracks.
- **Commit after every task**, with the message the task gives.

## Measured facts this plan is built on

Taken from the real 379-track library on 2026-09-22, not from documentation:

| Fact | Value |
|---|---|
| `setVideoId` | Present on 379/379 rows, **379 distinct values** — safe to key a reorder on |
| `trackCount` vs items returned | **382 vs 379** — three items are counted and never returned |
| Unavailable tracks | 5, and all are returned with both ids intact |
| `album` | Absent (`None`) on 151 of 379 rows |
| `videoType` | `ATV` 224, `OMV` 132, `UGC` 10, `None` 13 |
| Field set | Varies by type — `feedbackTokens` exists on `ATV` rows and is **absent** on `OMV`/`UGC` |
| Absent everywhere | date added, track number, release year, ISRC |

---

## Task 1: Give `executeReorder` a `keyOf` option

The planner keys its move plan on `track.originalIndex`. A YouTube writer needs `setVideoId`. This is the precondition the previous plan's final review flagged, now answerable: `setVideoId` was measured unique across all 379 rows.

**Files:**
- Modify: `src/plan/execute.js:49-51`
- Test: `src/plan/execute.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `executeReorder({ writer, playlistId, currentTracks, targetTracks, snapshotId, keyOf, onProgress, signal, dryRun })` where `keyOf` is `(track) => any`, defaulting to `(track) => track.originalIndex`. Every op's `key` and `beforeKey` are then drawn from `keyOf`. Return shape unchanged.

- [ ] **Step 1: Write the failing test**

Add to `src/plan/execute.test.js`:

```js
describe('keyOf', () => {
  test('defaults to originalIndex', async () => {
    const writer = fakeWriter()
    const tracks = playlist(4)
    await executeReorder({
      writer,
      playlistId: 'p1',
      currentTracks: tracks,
      targetTracks: [tracks[3], tracks[0], tracks[1], tracks[2]],
      snapshotId: 'snap-0',
    })
    expect(writer.calls[0].op.key).toBe(3)
  })

  test('uses the supplied key when one is given', async () => {
    const writer = fakeWriter()
    const tracks = playlist(4).map((track, i) => ({ ...track, itemId: `sv-${i}` }))
    await executeReorder({
      writer,
      playlistId: 'p1',
      currentTracks: tracks,
      targetTracks: [tracks[3], tracks[0], tracks[1], tracks[2]],
      snapshotId: 'snap-0',
      keyOf: (track) => track.itemId,
    })
    expect(writer.calls[0].op.key).toBe('sv-3')
    expect(writer.calls[0].op.beforeKey).toBe('sv-0')
  })

  test('refuses a key function that yields duplicates', async () => {
    const writer = fakeWriter()
    const tracks = playlist(3)
    await expect(
      executeReorder({
        writer,
        playlistId: 'p1',
        currentTracks: tracks,
        targetTracks: [tracks[2], tracks[0], tracks[1]],
        snapshotId: 'snap-0',
        keyOf: () => 'same',
      }),
    ).rejects.toThrow(/unique/)
  })
})
```

The third test matters most: `buildMoveOps` already throws on duplicate keys, and this pins that a bad `keyOf` fails loudly rather than scrambling a playlist.

- [ ] **Step 2: Run it and verify it fails**

```bash
npx vitest run src/plan/execute.test.js -t "keyOf"
```

Expected: the first test passes (that is today's behaviour), the second fails — `op.key` is `3`, not `'sv-3'`.

- [ ] **Step 3: Add the option**

In `src/plan/execute.js`, add `keyOf` to the destructured parameters with a default:

```js
  keyOf = (track) => track.originalIndex,
```

Then replace the two key-building lines (currently 49-51):

```js
  // originalIndex by default, never URI: a playlist may hold the same URI
  // several times, and positions must stay unambiguous. A service whose items
  // carry their own stable per-item id passes `keyOf` to use that instead —
  // YouTube's setVideoId, measured unique across a real 379-track playlist.
  const currentKeys = currentTracks.map(keyOf)
  const targetKeys = targetTracks.map(keyOf)
```

Add the JSDoc line beside the others:

```js
 * @param {(track: object) => any} [args.keyOf] per-item identity; must be unique
```

- [ ] **Step 4: Run the suite**

```bash
npm test
```

Expected: `303 passed` (300 + 3). `buildMoveOps` already raises on duplicate keys, so the third test should pass with no extra code — if it does not, report that rather than adding a second uniqueness check.

- [ ] **Step 5: Commit**

```bash
git add src/plan/execute.js src/plan/execute.test.js
git commit -m "Let executeReorder key its plan on a service item id"
```

---

## Task 2: Add `source` and `itemId` to the Track shape

Spec §6. Spotify sets `source: 'spotify'` and `itemId: null`; the YouTube adapter in Task 6 produces the same shape.

**Files:**
- Modify: `src/model/track.js:52-82` (the returned object)
- Test: `src/model/track.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: every Track from `normalizePlaylistItem` carries `source: 'spotify'` and `itemId: null`. Task 6 produces `source: 'youtube'` and `itemId: <setVideoId>`.

- [ ] **Step 1: Write the failing test**

Add to `src/model/track.test.js`:

```js
test('carries its source and a null item id', () => {
  const [track] = makeTracks([{ name: 'a' }])
  expect(track.source).toBe('spotify')
  // Spotify addresses a reorder by index, so there is no per-item id to carry.
  expect(track.itemId).toBeNull()
})
```

If `makeTracks` is not already imported in that file, import it from `../test/factory.js`.

- [ ] **Step 2: Run it and verify it fails**

```bash
npx vitest run src/model/track.test.js -t "carries its source"
```

Expected: FAIL — `track.source` is `undefined`.

- [ ] **Step 3: Add the fields**

In the object returned by `normalizePlaylistItem`, immediately after `originalIndex: index,`:

```js
    // Which service this Track came from, and the identity a write needs.
    // Spotify reorders by index and has no per-item id; YouTube's setVideoId
    // goes here. See docs/2026-09-18-youtube-mirror-design.md §6.
    source: 'spotify',
    itemId: null,
```

- [ ] **Step 4: Run the suite**

```bash
npm test
```

Expected: `304 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/model/track.js src/model/track.test.js
git commit -m "Carry source and item id on every Track"
```

---

## Task 3: Proxy scaffold, auth status, and ignore rules

**Files:**
- Create: `proxy/app.py`, `proxy/requirements.txt`, `proxy/test_app.py`, `proxy/README.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing
- Produces: a FastAPI app exposing `GET /auth/status` → `{"authenticated": bool}`. A module-level `get_client()` that Task 4's endpoints call and `test_app.py` monkeypatches.

- [ ] **Step 1: Add the ignore rules first**

Before any Python file exists, so credentials can never be staged by accident. Append to `.gitignore`:

```
# The YouTube proxy holds session credentials — never commit them.
proxy/browser.json
proxy/.venv/
proxy/__pycache__/
proxy/.pytest_cache/
```

Commit this on its own:

```bash
git add .gitignore
git commit -m "Ignore the YouTube proxy's credentials and virtualenv"
```

- [ ] **Step 2: Write `proxy/requirements.txt`**

```
fastapi==0.115.6
uvicorn==0.34.0
ytmusicapi==1.12.3
pytest==8.3.4
httpx==0.28.1
```

`ytmusicapi` is pinned exactly: browser auth is deprecated upstream, and an incidental upgrade could remove it. `httpx` is what FastAPI's `TestClient` uses.

- [ ] **Step 3: Write the failing test**

Create `proxy/test_app.py`:

```python
"""The proxy is thin by construction, so these tests cover auth and shape only."""
import pytest
from fastapi.testclient import TestClient

import app as proxy


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(proxy, "_client", None)
    return TestClient(proxy.app)


def test_auth_status_false_when_no_credentials(client, monkeypatch):
    monkeypatch.setattr(proxy, "credentials_path", lambda: "does-not-exist.json")
    assert client.get("/auth/status").json() == {"authenticated": False}


def test_auth_status_true_when_credentials_load(client, monkeypatch):
    monkeypatch.setattr(proxy, "get_client", lambda: object())
    assert client.get("/auth/status").json() == {"authenticated": True}


def test_cors_is_locked_to_the_vite_origin(client, monkeypatch):
    monkeypatch.setattr(proxy, "get_client", lambda: object())
    allowed = client.get("/auth/status", headers={"Origin": "http://127.0.0.1:5173"})
    assert allowed.headers.get("access-control-allow-origin") == "http://127.0.0.1:5173"

    evil = client.get("/auth/status", headers={"Origin": "http://evil.example"})
    assert evil.headers.get("access-control-allow-origin") is None
```

- [ ] **Step 4: Run it and verify it fails**

```bash
cd proxy && python -m pytest test_app.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app'`.

If `pytest` is not installed: `python -m pip install -r requirements.txt` first.

- [ ] **Step 5: Write `proxy/app.py`**

```python
"""Local proxy for YouTube Music.

YouTube Music sends no CORS headers, so a browser cannot call it directly.
This process makes those calls instead, and holds the session credentials so
the browser never sees them.

It holds NO business logic: it authenticates and translates, nothing more.
Every decision — ordering, matching, batching — stays in the JavaScript app
where the test suite lives. See docs/2026-09-18-youtube-mirror-design.md D13.
"""

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from ytmusicapi import YTMusic

VITE_ORIGIN = "http://127.0.0.1:5173"

app = FastAPI(title="Running Order — YouTube proxy")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[VITE_ORIGIN],
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["*"],
)

_client = None


def credentials_path() -> str:
    """Where the browser-auth credentials live. Override with YTM_BROWSER_JSON."""
    return os.environ.get("YTM_BROWSER_JSON") or str(Path(__file__).parent / "browser.json")


def get_client() -> YTMusic:
    """One client for the process lifetime. Raises if credentials are absent."""
    global _client
    if _client is None:
        _client = YTMusic(credentials_path())
    return _client


@app.get("/auth/status")
def auth_status() -> dict:
    """Whether stored credentials load. Never returns the credentials."""
    try:
        get_client()
        return {"authenticated": True}
    except Exception:
        return {"authenticated": False}
```

The bare `except Exception` is deliberate and is the one place it is allowed: a missing file, malformed JSON, and a rejected session are all "not authenticated" to the caller, and the distinction is not the browser's business.

- [ ] **Step 6: Run the tests**

```bash
cd proxy && python -m pytest test_app.py -v
```

Expected: 3 passed.

- [ ] **Step 7: Write `proxy/README.md`**

```markdown
# YouTube Music proxy

YouTube Music sends no CORS headers, so a browser cannot call it. This process
makes those calls and holds the credentials, so the browser never sees them.

It holds no business logic — auth and transport only.

## Setup

```bash
python -m pip install -r requirements.txt
```

Then produce credentials, from a directory **outside this repo**:

```bash
ytmusicapi browser
```

Copy the resulting `browser.json` into this directory. It is gitignored, and
it carries session cookies — treat it like a password.

## Running

```bash
uvicorn app:app --host 127.0.0.1 --port 8787
```

`GET /auth/status` answers `{"authenticated": true}` once credentials load.

## Tests

```bash
python -m pytest
```
```

- [ ] **Step 8: Commit**

```bash
git add proxy/
git commit -m "Add the YouTube proxy scaffold with auth status"
```

---

## Task 4: Proxy playlist endpoints

**Files:**
- Modify: `proxy/app.py`
- Test: `proxy/test_app.py`

**Interfaces:**
- Consumes: `get_client()` from Task 3
- Produces:
  - `GET /playlists` → `{"playlists": [{"id", "title", "count"}]}`
  - `GET /playlists/{playlist_id}` → `{"id", "title", "counted", "readable", "tracks": [...]}` where `tracks` are ytmusicapi's raw track dicts, passed through unchanged.

  `counted` is the playlist's own `trackCount`; `readable` is `len(tracks)`. They differ — measured 382 vs 379 — and the difference is surfaced rather than hidden.

- [ ] **Step 1: Write the failing tests**

Add to `proxy/test_app.py`:

```python
class FakeYT:
    def __init__(self, playlists=None, playlist=None):
        self._playlists = playlists or []
        self._playlist = playlist or {}
        self.get_playlist_calls = []

    def get_library_playlists(self, limit=None):
        return self._playlists

    def get_playlist(self, playlistId, limit=None):
        self.get_playlist_calls.append({"playlistId": playlistId, "limit": limit})
        return self._playlist


def test_lists_playlists(client, monkeypatch):
    fake = FakeYT(playlists=[
        {"playlistId": "PL1", "title": "punjabi songs", "count": 382},
        {"playlistId": "LM", "title": "Liked Music", "count": None},
    ])
    monkeypatch.setattr(proxy, "get_client", lambda: fake)
    body = client.get("/playlists").json()
    assert body == {"playlists": [
        {"id": "PL1", "title": "punjabi songs", "count": 382},
        {"id": "LM", "title": "Liked Music", "count": None},
    ]}


def test_playlist_always_requests_every_track(client, monkeypatch):
    fake = FakeYT(playlist={"id": "PL1", "title": "x", "trackCount": 382, "tracks": []})
    monkeypatch.setattr(proxy, "get_client", lambda: fake)
    client.get("/playlists/PL1")
    # The default truncates — measured at 200 of 379 against the real library.
    assert fake.get_playlist_calls == [{"playlistId": "PL1", "limit": None}]


def test_playlist_reports_counted_and_readable_separately(client, monkeypatch):
    tracks = [{"videoId": f"v{i}", "setVideoId": f"s{i}"} for i in range(379)]
    fake = FakeYT(playlist={"id": "PL1", "title": "x", "trackCount": 382, "tracks": tracks})
    monkeypatch.setattr(proxy, "get_client", lambda: fake)
    body = client.get("/playlists/PL1").json()
    assert body["counted"] == 382
    assert body["readable"] == 379
    assert len(body["tracks"]) == 379


def test_playlist_passes_tracks_through_unchanged(client, monkeypatch):
    raw = {"videoId": "v1", "setVideoId": "s1", "title": "t", "album": None,
           "videoType": "MUSIC_VIDEO_TYPE_OMV", "duration_seconds": 211}
    fake = FakeYT(playlist={"id": "PL1", "title": "x", "trackCount": 1, "tracks": [raw]})
    monkeypatch.setattr(proxy, "get_client", lambda: fake)
    # D13: the proxy reshapes nothing. Normalization happens in JS.
    assert client.get("/playlists/PL1").json()["tracks"] == [raw]
```

- [ ] **Step 2: Run them and verify they fail**

```bash
cd proxy && python -m pytest test_app.py -v
```

Expected: the four new tests fail with 404 — the routes do not exist.

- [ ] **Step 3: Add the endpoints**

Append to `proxy/app.py`:

```python
@app.get("/playlists")
def list_playlists() -> dict:
    """The user's library playlists, renamed to the app's field names."""
    raw = get_client().get_library_playlists(limit=None)
    return {
        "playlists": [
            {"id": p.get("playlistId"), "title": p.get("title"), "count": p.get("count")}
            for p in raw
        ]
    }


@app.get("/playlists/{playlist_id}")
def get_playlist(playlist_id: str) -> dict:
    """One playlist's tracks, passed through exactly as ytmusicapi returns them.

    `limit=None` is not optional: the default reads whole pages and returned
    200 of 379 tracks against the real library.

    `counted` and `readable` are reported separately because they differ —
    measured 382 against 379. Items YouTube counts but will not return cannot
    be ordered, so the app has to know they exist rather than infer a count.
    """
    raw = get_client().get_playlist(playlist_id, limit=None)
    tracks = raw.get("tracks") or []
    return {
        "id": raw.get("id"),
        "title": raw.get("title"),
        "counted": raw.get("trackCount"),
        "readable": len(tracks),
        "tracks": tracks,
    }
```

- [ ] **Step 4: Run the tests**

```bash
cd proxy && python -m pytest test_app.py -v
```

Expected: 7 passed.

- [ ] **Step 5: Verify against the real library**

This is the proof the fakes cannot give. Start the proxy:

```bash
cd proxy && uvicorn app:app --host 127.0.0.1 --port 8787
```

In another terminal:

```bash
curl -s http://127.0.0.1:8787/auth/status
curl -s "http://127.0.0.1:8787/playlists" | head -c 400
curl -s "http://127.0.0.1:8787/playlists/PLT8HDZKBTnzTAcVx7NFmvPU1MG_9d-WlY" | python -c "import json,sys; d=json.load(sys.stdin); print('counted', d['counted'], 'readable', d['readable'], 'tracks', len(d['tracks']))"
```

Expected: `authenticated: true`, the playlist list includes `punjabi songs`, and the last prints `counted 382 readable 379 tracks 379`.

Record the actual output in your report. If `browser.json` is not present in `proxy/`, say so and stop — do not create credentials yourself.

- [ ] **Step 6: Commit**

```bash
git add proxy/
git commit -m "Serve YouTube playlists and their tracks from the proxy"
```

---

## Task 5: The JavaScript client for the proxy

**Files:**
- Create: `src/services/youtube/client.js`
- Test: `src/services/youtube/client.test.js`

**Interfaces:**
- Consumes: the proxy routes from Task 4
- Produces:
  - `createYouTubeClient({ baseUrl, fetch })` → `{ authStatus(), listPlaylists(), fetchPlaylist(id) }`
  - `ProxyUnavailableError` — thrown when the proxy cannot be reached at all, distinct from an HTTP error, so the UI can say "the proxy is not running" rather than showing a network stack trace.
  - `authStatus()` → `boolean`. Returns `false` rather than throwing when the proxy is unreachable: spec §5 requires Spotify-only use to be unaffected by an absent proxy.

- [ ] **Step 1: Write the failing test**

Create `src/services/youtube/client.test.js`:

```js
import { describe, expect, test, vi } from 'vitest'
import { createYouTubeClient, ProxyUnavailableError } from './client.js'

const ok = (body) => ({ ok: true, status: 200, json: async () => body })

function clientWith(fetchImpl) {
  return createYouTubeClient({ baseUrl: 'http://127.0.0.1:8787', fetch: fetchImpl })
}

describe('createYouTubeClient', () => {
  test('reports authentication state', async () => {
    const client = clientWith(vi.fn(async () => ok({ authenticated: true })))
    expect(await client.authStatus()).toBe(true)
  })

  test('authStatus is false when the proxy is not running', async () => {
    // A dead proxy must not break Spotify-only use, so this cannot throw.
    const client = clientWith(vi.fn(async () => { throw new TypeError('fetch failed') }))
    expect(await client.authStatus()).toBe(false)
  })

  test('lists playlists', async () => {
    const fetchImpl = vi.fn(async () => ok({ playlists: [{ id: 'PL1', title: 'x', count: 3 }] }))
    const client = clientWith(fetchImpl)
    expect(await client.listPlaylists()).toEqual([{ id: 'PL1', title: 'x', count: 3 }])
    expect(fetchImpl.mock.calls[0][0]).toBe('http://127.0.0.1:8787/playlists')
  })

  test('fetches a playlist and keeps both counts', async () => {
    const client = clientWith(vi.fn(async () =>
      ok({ id: 'PL1', title: 'x', counted: 382, readable: 379, tracks: [{ videoId: 'v' }] }),
    ))
    const result = await client.fetchPlaylist('PL1')
    expect(result.counted).toBe(382)
    expect(result.readable).toBe(379)
    expect(result.tracks).toHaveLength(1)
  })

  test('encodes the playlist id into the path', async () => {
    const fetchImpl = vi.fn(async () => ok({ tracks: [] }))
    await clientWith(fetchImpl).fetchPlaylist('PL/weird id')
    expect(fetchImpl.mock.calls[0][0]).toBe('http://127.0.0.1:8787/playlists/PL%2Fweird%20id')
  })

  test('throws ProxyUnavailableError when the proxy cannot be reached', async () => {
    const client = clientWith(vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(client.listPlaylists()).rejects.toBeInstanceOf(ProxyUnavailableError)
  })

  test('surfaces an HTTP error distinctly from an unreachable proxy', async () => {
    const client = clientWith(vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
    const failure = await client.listPlaylists().catch((error) => error)
    expect(failure).not.toBeInstanceOf(ProxyUnavailableError)
    expect(failure.message).toMatch(/500/)
  })
})
```

- [ ] **Step 2: Run it and verify it fails**

```bash
npx vitest run src/services/youtube/client.test.js
```

Expected: FAIL — cannot resolve `./client.js`.

- [ ] **Step 3: Write the client**

Create `src/services/youtube/client.js`:

```js
/**
 * Talks to the local YouTube proxy.
 *
 * The proxy is an ordinary HTTP API that happens to run on this machine, so
 * this is a plain fetch wrapper. It holds no YouTube knowledge beyond the
 * route shapes — normalization lives in ./track.js.
 */

const DEFAULT_BASE_URL = 'http://127.0.0.1:8787'

/** The proxy process is not running or not reachable. */
export class ProxyUnavailableError extends Error {
  constructor(cause) {
    super('The YouTube proxy is not running. Start it with `npm run dev`.', { cause })
    this.name = 'ProxyUnavailableError'
  }
}

export function createYouTubeClient({ baseUrl = DEFAULT_BASE_URL, fetch: fetchImpl = globalThis.fetch } = {}) {
  async function request(path) {
    let response
    try {
      response = await fetchImpl(`${baseUrl}${path}`)
    } catch (cause) {
      // A refused connection is a different problem from a failing request,
      // and the user can act on it, so it keeps its own type.
      throw new ProxyUnavailableError(cause)
    }
    if (!response.ok) {
      throw new Error(`YouTube proxy returned ${response.status} for ${path}`)
    }
    return response.json()
  }

  return {
    /**
     * Whether stored credentials load. Answers false rather than throwing when
     * the proxy is absent: Spotify-only use must not depend on it (spec §5).
     */
    async authStatus() {
      try {
        const body = await request('/auth/status')
        return body?.authenticated === true
      } catch {
        return false
      }
    },

    async listPlaylists() {
      const body = await request('/playlists')
      return body?.playlists ?? []
    },

    /** @returns {Promise<{id, title, counted, readable, tracks}>} */
    fetchPlaylist(playlistId) {
      return request(`/playlists/${encodeURIComponent(playlistId)}`)
    },
  }
}
```

- [ ] **Step 4: Run the suite**

```bash
npm test && npm run lint
```

Expected: `311 passed` (304 + 7), lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/services/youtube/
git commit -m "Add the JavaScript client for the YouTube proxy"
```

---

## Task 6: Normalize YouTube tracks into the Track shape

**Files:**
- Create: `src/services/youtube/track.js`
- Create: `src/services/youtube/fixtures.js`
- Test: `src/services/youtube/track.test.js`

**Interfaces:**
- Consumes: raw track dicts from `client.fetchPlaylist()`
- Produces: `normalizeYouTubeTracks(rawTracks)` → an array of Tracks in the same shape `src/model/track.js` produces, with `source: 'youtube'` and `itemId: <setVideoId>`.

- [ ] **Step 1: Write the fixtures**

Create `src/services/youtube/fixtures.js`. These are the **real field sets measured from a live library on 2026-09-22**, with titles and ids replaced. The shapes are exact — note `feedbackTokens` present on the album track and absent on the others, and `album: null` rather than missing:

```js
/**
 * Field sets measured from a real YouTube Music playlist on 2026-09-22.
 * Titles, ids and artist names are substituted; the SHAPES are exact —
 * including that `feedbackTokens` appears only on album tracks, and that
 * `album` is null rather than absent on videos and user uploads.
 */

export const ALBUM_TRACK = {
  album: { id: 'MPREb_album1', name: 'An Album' },
  artists: [{ id: 'UCartist1', name: 'An Artist' }],
  communityVoteStatus: null,
  duration: '3:31',
  duration_seconds: 211,
  feedbackTokens: { add: 'tok-add', remove: 'tok-remove' },
  inLibrary: false,
  isAvailable: true,
  isExplicit: false,
  likeStatus: 'INDIFFERENT',
  listenAgainFeedbackTokens: { pin: 'tok-pin', unpin: 'tok-unpin' },
  pinnedToListenAgain: false,
  setVideoId: 'SV0001',
  thumbnails: [{ url: 'https://example.invalid/a.jpg', width: 60, height: 60 }],
  title: 'Album Track',
  videoId: 'VID0001',
  videoType: 'MUSIC_VIDEO_TYPE_ATV',
  views: null,
}

export const MUSIC_VIDEO = {
  album: null,
  artists: [{ id: 'UCartist2', name: 'Another Artist' }],
  communityVoteStatus: null,
  duration: '4:02',
  duration_seconds: 242,
  inLibrary: false,
  isAvailable: true,
  isExplicit: false,
  likeStatus: 'INDIFFERENT',
  listenAgainFeedbackTokens: { pin: 'tok-pin', unpin: 'tok-unpin' },
  pinnedToListenAgain: false,
  setVideoId: 'SV0002',
  thumbnails: [{ url: 'https://example.invalid/b.jpg', width: 60, height: 60 }],
  title: 'A Music Video',
  videoId: 'VID0002',
  videoType: 'MUSIC_VIDEO_TYPE_OMV',
  views: null,
}

export const USER_UPLOAD = {
  ...MUSIC_VIDEO,
  artists: [{ id: null, name: 'Some Uploader' }],
  setVideoId: 'SV0003',
  title: 'A User Upload',
  videoId: 'VID0003',
  videoType: 'MUSIC_VIDEO_TYPE_UGC',
}

export const UNAVAILABLE = {
  ...MUSIC_VIDEO,
  isAvailable: false,
  setVideoId: 'SV0004',
  title: 'Gone',
  videoId: 'VID0004',
}

export const UNTYPED = {
  ...MUSIC_VIDEO,
  setVideoId: 'SV0005',
  title: 'Untyped',
  videoId: 'VID0005',
  videoType: null,
}
```

- [ ] **Step 2: Write the failing test**

Create `src/services/youtube/track.test.js`:

```js
import { describe, expect, test } from 'vitest'
import { normalizeYouTubeTracks } from './track.js'
import { ALBUM_TRACK, MUSIC_VIDEO, UNAVAILABLE, UNTYPED, USER_UPLOAD } from './fixtures.js'

describe('normalizeYouTubeTracks', () => {
  test('maps an album track onto the Track shape', () => {
    const [track] = normalizeYouTubeTracks([ALBUM_TRACK])
    expect(track.source).toBe('youtube')
    expect(track.id).toBe('VID0001')
    expect(track.itemId).toBe('SV0001')
    expect(track.name).toBe('Album Track')
    expect(track.artists).toEqual([{ id: 'UCartist1', name: 'An Artist' }])
    expect(track.album.name).toBe('An Album')
    expect(track.durationMs).toBe(211000)
    expect(track.originalIndex).toBe(0)
  })

  test('has no uri, so the writer can refuse to clone it', () => {
    const [track] = normalizeYouTubeTracks([ALBUM_TRACK])
    expect(track.uri).toBeNull()
  })

  test('leaves absent metadata empty rather than inventing it', () => {
    const [track] = normalizeYouTubeTracks([ALBUM_TRACK])
    // YouTube Music returns none of these. Faking them would make a sort
    // silently depend on a guess.
    expect(track.addedAt).toBeNull()
    expect(track.trackNumber).toBe(0)
    expect(track.discNumber).toBe(0)
    expect(track.releaseDateSortable).toBeNull()
    expect(track.popularity).toBe(0)
    expect(track.isrc).toBeNull()
  })

  test('handles a track with no album', () => {
    const [track] = normalizeYouTubeTracks([MUSIC_VIDEO])
    expect(track.album.name).toBe('')
    expect(track.album.id).toBeNull()
    expect(track.releaseDateSortable).toBeNull()
  })

  test('handles an artist with no id by falling back to the folded name', () => {
    const [track] = normalizeYouTubeTracks([USER_UPLOAD])
    expect(track.primaryArtist).toEqual({ id: null, name: 'Some Uploader' })
    expect(track.artistGroupKey).toBe('some uploader')
  })

  test('marks unavailable tracks', () => {
    const [track] = normalizeYouTubeTracks([UNAVAILABLE])
    expect(track.isUnavailable).toBe(true)
  })

  test('survives a missing videoType and a missing feedbackTokens', () => {
    // Measured: feedbackTokens is present on album tracks and absent on
    // videos and uploads, so the field set genuinely varies row to row.
    expect(() => normalizeYouTubeTracks([UNTYPED, MUSIC_VIDEO])).not.toThrow()
  })

  test('numbers tracks by fetch position', () => {
    const tracks = normalizeYouTubeTracks([ALBUM_TRACK, MUSIC_VIDEO, USER_UPLOAD])
    expect(tracks.map((t) => t.originalIndex)).toEqual([0, 1, 2])
  })

  test('drops a row with no setVideoId, because it cannot be reordered', () => {
    // null is the beforeKey end-of-list sentinel, so it must never be a key.
    const tracks = normalizeYouTubeTracks([ALBUM_TRACK, { ...MUSIC_VIDEO, setVideoId: null }])
    expect(tracks).toHaveLength(1)
    expect(tracks[0].itemId).toBe('SV0001')
  })

  test('is a permutation of the rows it accepts', () => {
    const raw = [ALBUM_TRACK, MUSIC_VIDEO, USER_UPLOAD, UNAVAILABLE, UNTYPED]
    expect(normalizeYouTubeTracks(raw)).toHaveLength(raw.length)
  })
})
```

- [ ] **Step 3: Run it and verify it fails**

```bash
npx vitest run src/services/youtube/track.test.js
```

Expected: FAIL — cannot resolve `./track.js`.

- [ ] **Step 4: Write the normalizer**

Create `src/services/youtube/track.js`:

```js
/**
 * Normalizes YouTube Music tracks into the same flat Track shape
 * src/model/track.js produces for Spotify, so sort/, csv/ and plan/ consume
 * both without knowing which service a Track came from.
 *
 * Pure module: no network, no browser APIs.
 *
 * What YouTube Music does not return — date added, track number, release
 * year, ISRC — is left empty rather than invented. Spec §1 records which
 * sorts that costs.
 */

import { sortKey } from '../../model/normalize.js'

const EMPTY_ALBUM = Object.freeze({
  id: null,
  name: '',
  releaseDate: null,
  releaseDatePrecision: null,
})

/**
 * @param {Array<object>} rawTracks ytmusicapi's track dicts, in playlist order
 * @returns {Array<object>} Tracks, renumbered by accepted position
 */
export function normalizeYouTubeTracks(rawTracks) {
  const tracks = []
  for (const raw of rawTracks ?? []) {
    // A row with no setVideoId cannot be addressed by a reorder, and null is
    // the beforeKey end-of-list sentinel — keying on it would corrupt a plan.
    if (!raw?.setVideoId) continue

    const artists = (raw.artists ?? []).map((artist) => ({
      id: artist?.id ?? null,
      name: artist?.name ?? '',
    }))
    const primaryArtist = artists[0] ?? null

    const album = raw.album
      ? { id: raw.album.id ?? null, name: raw.album.name ?? '', releaseDate: null, releaseDatePrecision: null }
      : EMPTY_ALBUM

    tracks.push({
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
      originalIndex: tracks.length,

      source: 'youtube',
      itemId: raw.setVideoId,

      isLocal: false,
      isUnavailable: raw.isAvailable === false,
      isEpisode: false,
    })
  }
  return tracks
}
```

Note `originalIndex: tracks.length` rather than the loop index: skipped rows must not leave gaps, because `originalIndex` is the default reorder key and must stay dense and unique.

- [ ] **Step 5: Run the suite**

```bash
npm test && npm run lint
```

Expected: `321 passed` (311 + 10), lint clean.

- [ ] **Step 6: Verify against the real library**

The fixtures are real shapes, but only real data proves the mapping. With the proxy running:

```bash
node --input-type=module -e "
const { createYouTubeClient } = await import('./src/services/youtube/client.js')
const { normalizeYouTubeTracks } = await import('./src/services/youtube/track.js')
const c = createYouTubeClient({})
const raw = await c.fetchPlaylist('PLT8HDZKBTnzTAcVx7NFmvPU1MG_9d-WlY')
const tracks = normalizeYouTubeTracks(raw.tracks)
console.log('counted', raw.counted, 'readable', raw.readable, 'normalized', tracks.length)
console.log('itemIds unique:', new Set(tracks.map(t => t.itemId)).size === tracks.length)
console.log('all have source youtube:', tracks.every(t => t.source === 'youtube'))
console.log('with album:', tracks.filter(t => t.album.name).length)
console.log('sample:', JSON.stringify(tracks[0], null, 2).slice(0, 400))
"
```

Expected: `counted 382 readable 379 normalized 379`, `itemIds unique: true`, `all have source youtube: true`, and roughly 228 with an album.

Record the actual output in your report. If the numbers differ from those, say so — they are measurements, not guarantees, and a change is information.

- [ ] **Step 7: Commit**

```bash
git add src/services/youtube/
git commit -m "Normalize YouTube tracks into the shared Track shape"
```

---

## Done when

- `npm test` reports 321 passing and `npm run lint` is clean
- `cd proxy && python -m pytest` reports 7 passing
- The real-library check in Task 6 Step 6 prints `normalized 379` with unique item ids
- `git status` shows no `browser.json` staged or tracked

## Not in this plan

| | Why not here |
|---|---|
| `services/registry.js` and capability gating | Needs the adapter to exist first; it is the next plan's opening task |
| UI: source picker, YouTube playlists on screen | Next plan — this one ends at "the data arrives correctly" |
| Disabling the three impossible sort strategies | Next plan, with the registry |
| `npm run dev` starting both processes | Next plan, once there is a UI reason to have the proxy up |
| `videoType` on the Track | Not needed until matching (Plan 4). Carrying an unused field now would be speculative |
| Any write to YouTube | Deliverable 2c |
