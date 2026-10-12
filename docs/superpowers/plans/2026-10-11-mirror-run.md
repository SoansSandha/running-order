# Mirror Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One **Update YouTube** action on the review screen that adds every settled find to the playlist missing it, reorders the YouTube playlist into Spotify's order, and can be undone exactly.

**Architecture:** The proxy gains two browser-header guards and three thin write routes. In JS, a YouTube writer joins the existing writer contract. A pure planner (`src/plan/mirror.js`) works out what to add and the target order from the two playlists and the match book alone. An executor (`src/plan/executeMirror.js`) runs guard → add → re-read → reorder → check, and the undo, with readers, writers and the undo record injected. A hook and a panel put it on the review screen, and the app holds the URL there while a run writes.

**Tech Stack:** React 19, Vite 8, Vitest 3, oxlint; Python 3.13, FastAPI 0.115, Starlette 0.41, Pydantic 2, ytmusicapi 1.12.3, pytest; playwright-cli for browser checks.

**Spec:** [docs/2026-10-11-mirror-run-design.md](../../2026-10-11-mirror-run-design.md). Read it before starting. Decisions D48–D55 are the "why" behind most of this plan.

## Global Constraints

- **Git (CLAUDE.md):** stage by path with `git add <paths>`. Never `git add -A` or `git add .`. **Never commit, push, merge or rebase.** Every "Stage" step means `git add` only. Never stage `proxy/browser.json`, `.env*`, `.local/` or `.playwright-cli/`.
- **No new dependencies**, JS or Python. `ytmusicapi` stays pinned at `==1.12.3`.
- **The proxy translates and nothing more (D13).** No error response ever interpolates an exception's own text, because a malformed `browser.json` would leak session cookies.
- **Live writes go only to the playlist "test punjabi songs", on the Spotify and YouTube Music test profiles, and each live check needs the owner's OK first.** Never open, sort or change any other playlist.
- **Copy strings verbatim from the spec**, §7 and §5:
  - `Settle N more songs first`
  - `This Spotify playlist isn't yours to add to.`
  - `Add 83 to YouTube · Add 4 to Spotify · about 212 moves`
  - `Order left as it is`
  - `3 items YouTube won't show us stay where they are.`
  - `Undo will last only until you leave this screen: this browser isn't keeping site data.`
  - `YouTube already matches.`
  - `Added 83 to YouTube and 4 to Spotify. Moved 212.`
  - `YouTube shows a different order than the one written. If this playlist is set to sort by date in YouTube Music, set it to Manual and run again.`
  - `A playlist changed since the preview. It has been re-read: check the new preview.`
  - `Remove 83 from YouTube and 4 from Spotify, and put YouTube's order back`
  - Phases: `Checking both playlists`, `Adding to Spotify`, `Adding to YouTube`, `Reading both playlists`, `Moving 120 of 212`, `Checking the result`.

  The spec writes straight apostrophes. The UI uses `’`, as the rest of the app does.
- **Commands:**
  - JS tests: `npm test`, or a single file with `npx vitest run <path>`.
  - Lint: `npm run lint`.
  - Python, from `proxy/`: `python -m pytest`.
- **Style:** match the surrounding code: plain JS, no TypeScript, comments that cite the spec section or decision they implement, and the existing comment density.

## Review Focus

The spec implies these inputs, but no feature test reaches them on its own. Each has a test in the task named.

1. **A Spotify row with no key** (a track Spotify no longer serves). It can be neither decided nor marked, so the run must not wait on it forever. *Test in Task 6.*
2. **A YouTube playlist set to add new songs at the top.** The run must still end in Spotify's order. *Test in Task 8.*
3. **A song added to either playlist by hand between the preview and the run.** Nothing may be written; the run reports the playlist as changed. *Test in Task 8.*
4. **A Spotify playlist the owner cannot edit, with songs to add to it**, reaching the executor without the panel's check. It must refuse before any write. *Test in Task 8.*
5. **A run that fails partway through adding.** Undo must then remove exactly what landed. *Tests in Tasks 8 and 9.*

---

### Task 1: Proxy guards (D48)

**Files:**
- Modify: `proxy/app.py` (imports and the app setup block, lines 12–28)
- Modify: `proxy/test_app.py` (the `client` fixture; new tests appended)
- Modify: `proxy/README.md` (the `/auth/status` paragraph)

**Interfaces:**
- Produces:
  - every route answers **400** to a request whose `Host` is not `127.0.0.1` or `localhost`;
  - every `POST`, `PATCH` and `DELETE` answers **403** unless `Origin` is exactly `http://127.0.0.1:5173`;
  - `proxy.VITE_ORIGIN` stays the constant tests import.

- [ ] **Step 1: Point the test fixtures at 127.0.0.1, and write the failing tests**

In `proxy/test_app.py`, replace the `client` fixture with these two fixtures:

```python
@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(proxy, "_client", None)
    # D48: the proxy answers only requests addressed to 127.0.0.1, and takes
    # writes only from the app's origin, which a browser always sends.
    return TestClient(proxy.app, base_url="http://127.0.0.1:8787", headers={"Origin": proxy.VITE_ORIGIN})


@pytest.fixture
def bare(monkeypatch):
    """No Origin at all: what curl, or any program that is not a browser, sends."""
    monkeypatch.setattr(proxy, "_client", None)
    return TestClient(proxy.app, base_url="http://127.0.0.1:8787")
```

Append to the end of `proxy/test_app.py`:

```python
def test_a_request_addressed_to_another_host_is_refused(monkeypatch):
    # D48: DNS rebinding reaches this port under the attacker's own name.
    monkeypatch.setattr(proxy, "get_client", lambda: object())
    rebound = TestClient(proxy.app, base_url="http://evil.example:8787")
    assert rebound.get("/auth/status").status_code == 400


def test_localhost_is_an_accepted_host(monkeypatch):
    monkeypatch.setattr(proxy, "get_client", lambda: object())
    local = TestClient(proxy.app, base_url="http://localhost:8787")
    assert local.get("/auth/status").status_code == 200


def test_a_write_from_another_origin_is_refused(client, monkeypatch):
    fake = FakeYT(playlist={"id": "LM", "tracks": []})
    monkeypatch.setattr(proxy, "get_client", lambda: fake)
    response = client.post("/auth/status", headers={"Origin": "http://evil.example"})
    assert response.status_code == 403
    assert fake.get_playlist_calls == []


def test_a_write_with_no_origin_is_refused(bare, monkeypatch):
    fake = FakeYT(playlist={"id": "LM", "tracks": []})
    monkeypatch.setattr(proxy, "get_client", lambda: fake)
    assert bare.post("/auth/status").status_code == 403
    assert fake.get_playlist_calls == []


def test_a_read_needs_no_origin(bare, monkeypatch):
    monkeypatch.setattr(proxy, "get_client", lambda: object())
    assert bare.get("/auth/status").json() == {"authenticated": True}
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run, from `proxy/`: `python -m pytest -q`
Expected: the existing tests pass. The rebound-host test FAILS (200, not 400), and both 403 tests FAIL (200).

- [ ] **Step 3: Add the guards**

In `proxy/app.py`, replace:

```python
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
```

with:

```python
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware
```

and replace:

```python
VITE_ORIGIN = "http://127.0.0.1:5173"

app = FastAPI(title="Running Order — YouTube proxy")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[VITE_ORIGIN],
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["*"],
)
```

with:

```python
VITE_ORIGIN = "http://127.0.0.1:5173"
WRITE_METHODS = {"POST", "PATCH", "DELETE"}

app = FastAPI(title="Running Order — YouTube proxy")


@app.middleware("http")
async def refuse_foreign_writes(request: Request, call_next):
    """A write must come from the app's own page (mirror run design D48).

    The app is cross-origin to this port, so a browser always sends its
    Origin on a write. A write with any other Origin, or with none (curl,
    another program), did not come from the app.
    """
    if request.method in WRITE_METHODS and request.headers.get("origin") != VITE_ORIGIN:
        return JSONResponse({"detail": "Writes are accepted only from the app."}, status_code=403)
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[VITE_ORIGIN],
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["*"],
)
# D48: DNS rebinding reaches this port under another name, as if it were that
# page's own origin, so CORS never applies. Added last, so it runs first.
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])
```

- [ ] **Step 4: Run the tests to verify they all pass**

Run, from `proxy/`: `python -m pytest -q`
Expected: all pass.

- [ ] **Step 5: Say how to call a write by hand**

In `proxy/README.md`, replace:

```markdown
`GET /auth/status` answers `{"authenticated": true}` once credentials load.
`POST /auth/status` makes one real call to YouTube, which is the only way to
tell a live session from an expired one.
```

with:

```markdown
`GET /auth/status` answers `{"authenticated": true}` once credentials load.
`POST /auth/status` makes one real call to YouTube, which is the only way to
tell a live session from an expired one.

Every request must be addressed to `127.0.0.1` or `localhost`, and every
`POST`, `PATCH` and `DELETE` must carry the app's own `Origin` (mirror run
design D48). To make one by hand:

```bash
curl -X POST -H "Origin: http://127.0.0.1:5173" http://127.0.0.1:8787/auth/status
```
```

- [ ] **Step 6: Stage**

```bash
git add proxy/app.py proxy/test_app.py proxy/README.md
```

---

### Task 2: Proxy write routes

**Files:**
- Modify: `proxy/app.py` (CORS methods; new models and routes appended)
- Modify: `proxy/test_app.py` (`RaisingYT` gains three methods; new tests appended)

**Interfaces:**
- Consumes: Task 1's guards.
- Produces:
  - `POST /playlists/{id}/items`, body `{ videoIds: [str] }` → `{ added: [{ videoId, setVideoId }] }`. **409** when YouTube refuses, in which case nothing was added.
  - `PATCH /playlists/{id}/order`, body `{ setVideoId: str, beforeSetVideoId: str | null }` → `{ ok: true }`. **409** on refusal.
  - `DELETE /playlists/{id}/items`, body `{ items: [{ videoId, setVideoId }] }` → `{ ok: true }`. **409** on refusal.
  - Any of them that fails to reach YouTube answers **502** with a fixed message and drops the cached client.

- [ ] **Step 1: Write the failing tests**

In `proxy/test_app.py`, add these three methods to the existing `RaisingYT` class, after `get_watch_playlist`:

```python
    def add_playlist_items(self, playlistId, videoIds=None, source_playlist=None, duplicates=False):
        raise RuntimeError(self._message)

    def edit_playlist(self, playlistId, moveItem=None):
        raise RuntimeError(self._message)

    def remove_playlist_items(self, playlistId, videos):
        raise RuntimeError(self._message)
```

Append to the end of the file:

```python
class WriteYT:
    """Records each edit, and answers as ytmusicapi does."""

    def __init__(self, add_response=None, status="STATUS_SUCCEEDED"):
        self._add_response = add_response
        self._status = status
        self.calls = []

    def add_playlist_items(self, playlistId, videoIds=None, source_playlist=None, duplicates=False):
        self.calls.append(("add", playlistId, videoIds, duplicates))
        return self._add_response

    def edit_playlist(self, playlistId, moveItem=None):
        self.calls.append(("move", playlistId, moveItem))
        return self._status

    def remove_playlist_items(self, playlistId, videos):
        self.calls.append(("remove", playlistId, videos))
        return self._status


# The shape add_playlist_items answers on success (ytmusicapi 1.12.3).
ADDED = {
    "status": "STATUS_SUCCEEDED",
    "playlistEditResults": [
        {"videoId": "v1", "setVideoId": "s1", "multiSelectData": {}},
        {"videoId": "v2", "setVideoId": "s2", "multiSelectData": {}},
    ],
}


def test_add_refuses_duplicates_and_answers_the_new_item_ids(client, monkeypatch):
    fake = WriteYT(add_response=ADDED)
    monkeypatch.setattr(proxy, "get_client", lambda: fake)
    response = client.post("/playlists/PL1/items", json={"videoIds": ["v1", "v2"]})
    assert response.json() == {
        "added": [{"videoId": "v1", "setVideoId": "s1"}, {"videoId": "v2", "setVideoId": "s2"}],
    }
    # duplicates=False: one video already present refuses the whole request.
    assert fake.calls == [("add", "PL1", ["v1", "v2"], False)]


def test_a_refused_add_is_a_409(client, monkeypatch):
    fake = WriteYT(add_response={"status": "STATUS_FAILED", "actions": []})
    monkeypatch.setattr(proxy, "get_client", lambda: fake)
    response = client.post("/playlists/PL1/items", json={"videoIds": ["v1"]})
    assert response.status_code == 409
    assert "added" not in response.json()


def test_a_write_body_must_be_json(client, monkeypatch):
    # A plain HTML form posted from another site is form-encoded.
    fake = WriteYT(add_response=ADDED)
    monkeypatch.setattr(proxy, "get_client", lambda: fake)
    response = client.post(
        "/playlists/PL1/items",
        content="videoIds=v1",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert response.status_code == 422
    assert fake.calls == []


def test_move_before_another_item(client, monkeypatch):
    fake = WriteYT()
    monkeypatch.setattr(proxy, "get_client", lambda: fake)
    response = client.patch("/playlists/PL1/order", json={"setVideoId": "s1", "beforeSetVideoId": "s9"})
    assert response.json() == {"ok": True}
    assert fake.calls == [("move", "PL1", ("s1", "s9"))]


def test_move_with_no_successor_names_only_the_item(client, monkeypatch):
    fake = WriteYT()
    monkeypatch.setattr(proxy, "get_client", lambda: fake)
    client.patch("/playlists/PL1/order", json={"setVideoId": "s1", "beforeSetVideoId": None})
    assert fake.calls == [("move", "PL1", "s1")]


def test_a_refused_move_is_a_409(client, monkeypatch):
    monkeypatch.setattr(proxy, "get_client", lambda: WriteYT(status={"status": "STATUS_FAILED"}))
    assert client.patch("/playlists/PL1/order", json={"setVideoId": "s1"}).status_code == 409


def test_remove_passes_both_ids_of_each_item(client, monkeypatch):
    fake = WriteYT()
    monkeypatch.setattr(proxy, "get_client", lambda: fake)
    items = [{"videoId": "v1", "setVideoId": "s1"}]
    response = client.request("DELETE", "/playlists/PL1/items", json={"items": items})
    assert response.json() == {"ok": True}
    assert fake.calls == [("remove", "PL1", items)]


WRITES = [
    ("POST", "/playlists/PL1/items", {"videoIds": ["v1"]}),
    ("PATCH", "/playlists/PL1/order", {"setVideoId": "s1"}),
    ("DELETE", "/playlists/PL1/items", {"items": [{"videoId": "v1", "setVideoId": "s1"}]}),
]


@pytest.mark.parametrize("method,path,body", WRITES)
def test_every_write_needs_the_apps_origin(bare, monkeypatch, method, path, body):
    fake = WriteYT(add_response=ADDED)
    monkeypatch.setattr(proxy, "get_client", lambda: fake)
    assert bare.request(method, path, json=body).status_code == 403
    assert fake.calls == []


@pytest.mark.parametrize("method,path,body", WRITES)
def test_a_failing_write_is_clean_and_drops_the_cached_client(client, monkeypatch, method, path, body):
    monkeypatch.setattr(proxy, "_client", RaisingYT("top secret cookie"))
    response = client.request(method, path, json=body)
    assert response.status_code == 502
    assert "top secret cookie" not in response.text
    assert proxy._client is None


def test_cors_lets_the_app_delete(client):
    preflight = client.options(
        "/playlists/PL1/items",
        headers={"Origin": proxy.VITE_ORIGIN, "Access-Control-Request-Method": "DELETE"},
    )
    assert "DELETE" in preflight.headers.get("access-control-allow-methods", "")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run, from `proxy/`: `python -m pytest -q`
Expected: the new write tests FAIL with 404 or 405 (no such routes), the CORS test FAILS, and `test_every_write_needs_the_apps_origin` passes already (Task 1's guard).

- [ ] **Step 3: Allow DELETE through CORS**

In `proxy/app.py`, replace `allow_methods=["GET", "POST", "PATCH"],` with:

```python
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
```

- [ ] **Step 4: Add the routes**

In `proxy/app.py`, add `from pydantic import BaseModel` after the `fastapi.responses` import. Then append to the end of the file:

```python
class AddItems(BaseModel):
    videoIds: list[str]


class MoveItem(BaseModel):
    setVideoId: str
    beforeSetVideoId: str | None = None


class PlaylistItem(BaseModel):
    videoId: str
    setVideoId: str


class RemoveItems(BaseModel):
    items: list[PlaylistItem]


def succeeded(response) -> bool:
    """ytmusicapi answers an edit with its status string, or with the whole
    response when YouTube did not succeed."""
    status = response.get("status") if isinstance(response, dict) else response
    return isinstance(status, str) and "SUCCEEDED" in status


@app.post("/playlists/{playlist_id}/items")
def add_items(playlist_id: str, body: AddItems) -> dict:
    """Add videos, and answer the item id YouTube gave each (mirror run design §3).

    With `duplicates=False` YouTube refuses the whole request if any video is
    already in the playlist, so a refusal (409) means nothing was added.
    """
    try:
        response = get_client().add_playlist_items(playlist_id, body.videoIds, duplicates=False)
    except Exception:
        reset_client()
        # Never interpolate the exception's own string (see get_playlist).
        raise HTTPException(status_code=502, detail="Could not reach YouTube Music.")
    if not succeeded(response):
        raise HTTPException(status_code=409, detail="YouTube Music refused the addition.")
    return {
        "added": [
            {"videoId": result.get("videoId"), "setVideoId": result.get("setVideoId")}
            for result in response.get("playlistEditResults") or []
            if result
        ]
    }


@app.patch("/playlists/{playlist_id}/order")
def move_item(playlist_id: str, body: MoveItem) -> dict:
    """Move one item before another, or, with no successor, to the end.

    This is edit_playlist's own form, so the JS move plan passes straight
    through (mirror design §4). The probe confirms that no successor means
    the end (mirror run design §9).
    """
    move = (body.setVideoId, body.beforeSetVideoId) if body.beforeSetVideoId else body.setVideoId
    try:
        response = get_client().edit_playlist(playlist_id, moveItem=move)
    except Exception:
        reset_client()
        raise HTTPException(status_code=502, detail="Could not reach YouTube Music.")
    if not succeeded(response):
        raise HTTPException(status_code=409, detail="YouTube Music refused the move.")
    return {"ok": True}


@app.delete("/playlists/{playlist_id}/items")
def remove_items(playlist_id: str, body: RemoveItems) -> dict:
    """Remove items, each named by its videoId and setVideoId. Undo is the only caller."""
    try:
        response = get_client().remove_playlist_items(playlist_id, [item.model_dump() for item in body.items])
    except Exception:
        reset_client()
        raise HTTPException(status_code=502, detail="Could not reach YouTube Music.")
    if not succeeded(response):
        raise HTTPException(status_code=409, detail="YouTube Music refused the removal.")
    return {"ok": True}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run, from `proxy/`: `python -m pytest -q`
Expected: all pass.

- [ ] **Step 6: Stage**

```bash
git add proxy/app.py proxy/test_app.py
```

---

### Task 3: The live probe (needs the owner's OK)

> **Amended 2026-10-12 (owner's decision; see CLAUDE.md, "Live checks"):** live checks run in the owner's
> Chrome through the Claude in Chrome connector, not in `playwright-cli -s=live`. Each script's
> `page.evaluate` body runs in a connector tab at `http://127.0.0.1:5173`, and the owner's match book
> comes from `.local/real-library/match-book.json`. The steps below otherwise stand.

The run code relies on four facts nobody has measured. This task measures them on "test punjabi songs", puts back everything it adds, and records the results in the spec.

**Files:**
- Create (never staged): `.playwright-cli/probe-mirror.js`
- Modify: `docs/2026-10-11-mirror-run-design.md` (§9, a "Measured" table)

**Interfaces:**
- Produces, for later tasks:
  - `YOUTUBE_CHUNK` (Task 8): 50, confirmed or corrected;
  - the Spotify removal body key (Task 5): `items` or `tracks`;
  - confirmation that a move with no successor goes to the end (Tasks 2, 5, 8).

- [ ] **Step 1: Ask the owner**

Send the owner exactly this and wait for a yes:

> The probe writes to "test punjabi songs" on the test profiles only. On YouTube Music it adds one settled find, moves it twice, removes it, then adds 50 settled finds in one request and removes them in one request. On Spotify it adds one settled find and removes it. Everything it adds is removed again, even if a step fails, and it reports whether both playlists are back exactly as they were. OK to run it?

- [ ] **Step 2: Start what it needs**

- If nothing answers at `http://127.0.0.1:5173`, start `npm run dev` in the background (the probe needs the proxy too). If something already answers, use it and leave it running.
- `proxy/browser.json` must be the capture from the **YouTube test profile** (CLAUDE.md).
- Open the live session: `playwright-cli -s=live open http://127.0.0.1:5173 --headed --profile=.playwright-cli/live-profile`. If the Spotify library does not show, ask the owner to sign in to the Spotify test profile in that window. Never type credentials.

- [ ] **Step 3: Write the probe**

Create `.playwright-cli/probe-mirror.js`:

```js
// The mirror run probe (docs/2026-10-11-mirror-run-design.md §9). It writes
// only to "test punjabi songs", on the test profiles, and removes everything
// it adds, even when a step fails. Run it from the signed-in live session,
// with `npm run dev` serving the app and the proxy:
//   playwright-cli -s=live --raw run-code --filename=.playwright-cli/probe-mirror.js
async (page) => {
  const NAME = 'test punjabi songs'
  await page.goto('http://127.0.0.1:5173/')
  // Let the app finish resuming its Spotify session first: both it and this
  // probe refresh the rotating refresh token, and they must not race.
  await page.waitForFunction((name) => document.body.textContent.includes(name), NAME, { timeout: 30000 })

  const out = await page.evaluate(async (NAME) => {
    const out = {}
    const book = JSON.parse(localStorage.getItem('playlist-sorter:match-book') ?? '[]')

    // ---- YouTube Music, through the proxy, exactly as the app will call it ----
    const proxy = async (path, method = 'GET', body) => {
      const init =
        method === 'GET'
          ? undefined
          : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      const response = await fetch(`http://127.0.0.1:8787${path}`, init)
      const text = await response.text()
      if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${text}`)
      return JSON.parse(text)
    }
    const named = (await proxy('/playlists')).playlists.filter((p) => p.title === NAME)
    if (named.length !== 1) return { error: `Expected one YouTube playlist named "${NAME}", found ${named.length}.` }
    const yt = named[0].id
    const read = async () =>
      (await proxy(`/playlists/${yt}`)).tracks.map((t) => ({ videoId: t.videoId, setVideoId: t.setVideoId }))
    const before = await read()
    const present = new Set(before.map((t) => t.videoId))
    const finds = [
      ...new Set(book.filter((e) => e.verdict === 'same' && e.found?.side === 'youtube').map((e) => e.youtubeVideoId)),
    ].filter((id) => !present.has(id))
    out.youtubeFinds = finds.length
    if (finds.length < 50) return { ...out, error: 'Fewer than 50 settled YouTube finds to probe with.' }

    const added = []
    try {
      // 1. One song: what the add answers, where it lands, and whether the
      //    items already there keep their ids.
      const [one] = (await proxy(`/playlists/${yt}/items`, 'POST', { videoIds: [finds[0]] })).added
      added.push(one)
      out.addAnswer = one
      const afterOne = await read()
      out.lengthBefore = before.length
      out.landedAt = afterOne.findIndex((t) => t.setVideoId === one.setVideoId)
      out.otherItemIdsKept = before.every((t) => afterOne.some((a) => a.setVideoId === t.setVideoId))
      // 2. Move it before the first item, then with no successor.
      const first = afterOne.find((t) => t.setVideoId !== one.setVideoId)
      await proxy(`/playlists/${yt}/order`, 'PATCH', { setVideoId: one.setVideoId, beforeSetVideoId: first.setVideoId })
      out.afterMoveBeforeFirst = (await read()).findIndex((t) => t.setVideoId === one.setVideoId)
      await proxy(`/playlists/${yt}/order`, 'PATCH', { setVideoId: one.setVideoId, beforeSetVideoId: null })
      const afterEnd = await read()
      out.afterMoveNoSuccessor = afterEnd.findIndex((t) => t.setVideoId === one.setVideoId)
      out.lastIndex = afterEnd.length - 1
      // 3. Remove it.
      await proxy(`/playlists/${yt}/items`, 'DELETE', { items: [one] })
      added.length = 0
      // 4. Fifty in one request, then remove them in one request.
      const batch = (await proxy(`/playlists/${yt}/items`, 'POST', { videoIds: finds.slice(0, 50) })).added
      added.push(...batch)
      out.batchAdded = batch.length
      await proxy(`/playlists/${yt}/items`, 'DELETE', { items: batch })
      added.length = 0
    } catch (failure) {
      out.youtubeError = failure.message
    } finally {
      if (added.length > 0) {
        try {
          await proxy(`/playlists/${yt}/items`, 'DELETE', { items: added })
        } catch (failure) {
          out.youtubeCleanupError = failure.message
        }
      }
      const after = await read()
      out.youtubeSongsRestored = JSON.stringify(after.map((t) => t.videoId)) === JSON.stringify(before.map((t) => t.videoId))
      out.youtubeItemIdsUnchanged = JSON.stringify(after.map((t) => t.setVideoId)) === JSON.stringify(before.map((t) => t.setVideoId))
    }

    // ---- Spotify: one add and one removal, to learn the removal's body ----
    const { refreshTokens } = await import('/src/services/spotify/spotifyAuth.js')
    const tokens = await refreshTokens({
      clientId: localStorage.getItem('playlist-sorter:client-id'),
      refreshToken: localStorage.getItem('playlist-sorter:refresh-token'),
    })
    // Spotify rotates refresh tokens: keep the new one, or the app's next resume fails.
    localStorage.setItem('playlist-sorter:refresh-token', tokens.refreshToken)
    const api = async (url, method = 'GET', body) => {
      const response = await fetch(url.startsWith('https://') ? url : `https://api.spotify.com/v1${url}`, {
        method,
        headers: { Authorization: `Bearer ${tokens.accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      return { status: response.status, body: await response.json().catch(() => null) }
    }
    const every = async (url) => {
      const items = []
      for (let next = url; next; ) {
        const { body } = await api(next)
        items.push(...(body?.items ?? []))
        next = body?.next ?? null
      }
      return items
    }
    const mine = (await every('/me/playlists?limit=50')).filter((p) => p?.name === NAME)
    if (mine.length !== 1) return { ...out, spotifyError: `Expected one Spotify playlist named "${NAME}", found ${mine.length}.` }
    const sp = mine[0].id
    const uris = async () =>
      (await every(`/playlists/${sp}/items?limit=100&fields=next,items(item(uri),track(uri))`)).map(
        (i) => (i.item ?? i.track)?.uri ?? null,
      )
    const spBefore = await uris()
    // A song the playlist does not hold, so removing "every copy" removes only ours.
    const uri = book
      .filter((e) => e.verdict === 'same' && e.found?.side === 'spotify' && e.found.uri)
      .map((e) => e.found.uri)
      .find((candidate) => !spBefore.includes(candidate))
    if (!uri) return { ...out, spotifyError: 'No settled Spotify find that is not already in the playlist.' }
    out.spotifyAdd = (await api(`/playlists/${sp}/items`, 'POST', { uris: [uri] })).status
    out.spotifyRemoveWithItems = (await api(`/playlists/${sp}/items`, 'DELETE', { items: [{ uri }] })).status
    if (!(await uris()).includes(uri)) {
      out.spotifyRemoveBody = 'items'
    } else {
      out.spotifyRemoveWithTracks = (await api(`/playlists/${sp}/items`, 'DELETE', { tracks: [{ uri }] })).status
      out.spotifyRemoveBody = (await uris()).includes(uri) ? 'neither: the song is still in the playlist' : 'tracks'
    }
    out.spotifyRestored = JSON.stringify(await uris()) === JSON.stringify(spBefore)
    return out
  }, NAME)

  await page.reload()
  return JSON.stringify(out, null, 1)
}
```

- [ ] **Step 4: Run it**

Run: `playwright-cli -s=live --raw run-code --filename=.playwright-cli/probe-mirror.js`

Expected: a JSON report with no `error`, `youtubeError`, `youtubeCleanupError` or `spotifyError`. `youtubeSongsRestored: true` and `spotifyRestored: true`.

- [ ] **Step 5: Act on what it measured**

| Field | Expected | If not |
|---|---|---|
| `youtubeSongsRestored`, `spotifyRestored` | `true` | **Stop.** Tell the owner exactly which playlist differs and how. Do not continue |
| `afterMoveNoSuccessor` | equals `lastIndex` | **Stop and bring it to the owner.** `diff.js` emits `beforeKey: null` for "to the end", and the YouTube writer would need another way to express it |
| `batchAdded` | `50` | **Stop and bring it to the owner** with the error. `YOUTUBE_CHUNK` must come down |
| `spotifyRemoveBody` | `items` or `tracks` | **Stop**: neither body removed the song, and the owner must remove it by hand |
| `otherItemIdsKept`, `youtubeItemIdsUnchanged`, `landedAt` | Recorded either way | Nothing to change: step 5 of the run re-reads regardless |

- [ ] **Step 6: Record the measurements in the spec**

In `docs/2026-10-11-mirror-run-design.md` §9, directly after the line `   their measurements.`, add (fill each value from the report):

```markdown
**Measured** on <date>, by `.playwright-cli/probe-mirror.js` against "test punjabi songs":

| Question | Answer |
|---|---|
| What an add answers | `{ videoId, setVideoId }` per song: <addAnswer> |
| Where an added song lands | Index <landedAt> of <lengthBefore + 1> (<the end / the top>) |
| Whether adding reissues other items' `setVideoId`s | <No / Yes> (`otherItemIdsKept`: <value>) |
| A move with no successor | Goes to index <afterMoveNoSuccessor> of <lastIndex>: <the end> |
| 50 videos in one add | <Accepted: 50 added, 50 removed in one request> |
| Spotify's removal body on `/playlists/{id}/items` | `{ <items or tracks>: [{ uri }] }` (status <status>) |
| Both playlists afterwards | Unchanged |
```

- [ ] **Step 7: Close up, and stage**

Run `playwright-cli -s=live close`. Stop the dev server if you started it. Then:

```bash
git add docs/2026-10-11-mirror-run-design.md
```

---

### Task 4: YouTube client write methods

**Files:**
- Modify: `src/services/youtube/client.js`
- Test: `src/services/youtube/client.test.js`

**Interfaces:**
- Consumes: Task 2's routes.
- Produces:
  - `client.addItems(playlistId, videoIds) → Promise<Array<{videoId, setVideoId}>>`
  - `client.moveItem(playlistId, setVideoId, beforeSetVideoId | null) → Promise<void>`
  - `client.removeItems(playlistId, items: Array<{videoId, setVideoId}>) → Promise<void>`
  - `export class YouTubeRefusedError extends Error`, thrown on a 409, with the proxy's `detail` as its message.

- [ ] **Step 1: Write the failing tests**

In `src/services/youtube/client.test.js`, change the import to:

```js
import { createYouTubeClient, ProxyUnavailableError, YouTubeRefusedError, YouTubeSessionExpiredError } from './client.js'
```

Add below `const ok = …`:

```js
const answer = (status, body) => ({ ok: status < 400, status, json: async () => body })
```

Add these tests inside `describe('createYouTubeClient', …)`, after the last test:

```js
  test('adds videos with a JSON body, and answers the ids they were given', async () => {
    const fetchImpl = vi.fn(async () => ok({ added: [{ videoId: 'v1', setVideoId: 's1' }] }))
    const added = await clientWith(fetchImpl).addItems('PL1', ['v1'])
    expect(added).toEqual([{ videoId: 'v1', setVideoId: 's1' }])
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8787/playlists/PL1/items')
    expect(init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } })
    expect(JSON.parse(init.body)).toEqual({ videoIds: ['v1'] })
  })

  test('moves an item before another, and with null to the end', async () => {
    const fetchImpl = vi.fn(async () => ok({ ok: true }))
    await clientWith(fetchImpl).moveItem('PL1', 's1', null)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8787/playlists/PL1/order')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ setVideoId: 's1', beforeSetVideoId: null })
  })

  test('removes items, each named by both its ids', async () => {
    const fetchImpl = vi.fn(async () => ok({ ok: true }))
    await clientWith(fetchImpl).removeItems('PL1', [{ videoId: 'v1', setVideoId: 's1' }])
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8787/playlists/PL1/items')
    expect(init.method).toBe('DELETE')
    expect(JSON.parse(init.body)).toEqual({ items: [{ videoId: 'v1', setVideoId: 's1' }] })
  })

  test('a refusal is its own error, carrying what the proxy said', async () => {
    const fetchImpl = vi.fn(async () => answer(409, { detail: 'YouTube Music refused the addition.' }))
    const adding = clientWith(fetchImpl).addItems('PL1', ['v1'])
    await expect(adding).rejects.toThrow(YouTubeRefusedError)
    await expect(adding).rejects.toThrow('YouTube Music refused the addition.')
  })

  test('a read is still a plain fetch of the path', async () => {
    const fetchImpl = vi.fn(async () => ok({ playlists: [] }))
    await clientWith(fetchImpl).listPlaylists()
    expect(fetchImpl.mock.calls[0][1]).toBeUndefined()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/services/youtube/client.test.js`
Expected: FAIL. `YouTubeRefusedError` is not exported, and `addItems` is not a function.

- [ ] **Step 3: Implement**

In `src/services/youtube/client.js`, add after the `YouTubeSessionExpiredError` class:

```js
/**
 * YouTube Music refused a change: an addition, a move or a removal. The
 * proxy reports it as a 409. For an addition it means nothing in that
 * request was added (mirror run design §3).
 */
export class YouTubeRefusedError extends Error {
  constructor(detail) {
    super(detail || 'YouTube Music refused the change.')
    this.name = 'YouTubeRefusedError'
  }
}
```

Replace the `request` function:

```js
  async function request(path) {
    let response
    try {
      response = await fetchImpl(`${baseUrl}${path}`)
    } catch (cause) {
```

with:

```js
  async function request(path, { method = 'GET', body } = {}) {
    // A write carries JSON: the proxy reads a body only as JSON (D48).
    const init =
      method === 'GET'
        ? undefined
        : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    let response
    try {
      response = await fetchImpl(`${baseUrl}${path}`, init)
    } catch (cause) {
```

and, in the same function, replace:

```js
    if (response.status === 401) throw new YouTubeSessionExpiredError()
```

with:

```js
    if (response.status === 401) throw new YouTubeSessionExpiredError()
    if (response.status === 409) {
      const detail = await response.json().then((answer) => answer?.detail, () => null)
      throw new YouTubeRefusedError(detail)
    }
```

Add these methods after `track(videoId)` in the returned object:

```js
    /** Add videos in this order, and answer the item id each was given (mirror run design §3). */
    async addItems(playlistId, videoIds) {
      const body = await request(`/playlists/${encodeURIComponent(playlistId)}/items`, {
        method: 'POST',
        body: { videoIds },
      })
      return body?.added ?? []
    },

    /** Move one item before another; a null `beforeSetVideoId` moves it to the end. */
    async moveItem(playlistId, setVideoId, beforeSetVideoId) {
      await request(`/playlists/${encodeURIComponent(playlistId)}/order`, {
        method: 'PATCH',
        body: { setVideoId, beforeSetVideoId },
      })
    },

    /** Remove playlist items, each named by its videoId and setVideoId. */
    async removeItems(playlistId, items) {
      await request(`/playlists/${encodeURIComponent(playlistId)}/items`, {
        method: 'DELETE',
        body: { items },
      })
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/services/youtube/client.test.js`
Expected: PASS, including every test that was there before.

- [ ] **Step 5: Stage**

```bash
git add src/services/youtube/client.js src/services/youtube/client.test.js
```

---

### Task 5: The two writers

**Files:**
- Create: `src/services/youtube/writer.js`
- Test: `src/services/youtube/writer.test.js`
- Modify: `src/services/spotify/mutations.js`, `src/services/spotify/writer.js`
- Test: `src/services/spotify/mutations.test.js`, `src/services/spotify/writer.test.js`
- Modify: `src/test/factory.js` (adds `makeYouTubeTracks`)

**Interfaces:**
- Consumes: Task 4's client methods. Task 3's measured Spotify removal key; the code below uses `items`, so if Task 3 recorded `tracks`, use `tracks` in both the code and the tests.
- Produces:
  - `createYouTubeWriter(client)`, whose methods each send **one** request:
    - `reorder(playlistId, op) → Promise<void>`: sends `op.key` before `op.beforeKey`;
    - `addTracks(playlistId, tracks) → Promise<Array<{videoId, setVideoId}>>`;
    - `removeTracks(playlistId, items: Array<{videoId, setVideoId}>) → Promise<void>`.
  - Spotify writer, new method: `removeTracks(playlistId, tracks: Array<{uri}>) → Promise<void>`. One request, at most 100. The existing `addTracks(playlistId, tracks)` sends one request when given at most 100.
  - `removeTracks(client, playlistId, uris)` in `mutations.js`.
  - `makeYouTubeTracks(rows)` in `src/test/factory.js`: rows `{ videoId, title?, setVideoId?, seconds? }` → normalized YouTube Tracks, with `setVideoId` defaulting to `set-<videoId>`.

- [ ] **Step 1: Add the YouTube test factory**

In `src/test/factory.js`, add below the existing import:

```js
import { normalizeYouTubeTracks } from '../services/youtube/track.js'
```

and append to the end of the file:

```js
/**
 * Build normalized YouTube Tracks through the real normalizer. A row's
 * setVideoId defaults to `set-<videoId>`; give two copies of a song their
 * own to tell them apart.
 */
export function makeYouTubeTracks(rows) {
  return normalizeYouTubeTracks(
    rows.map(({ videoId, title = videoId, setVideoId = `set-${videoId}`, seconds = 200 }) => ({
      videoId,
      setVideoId,
      title,
      artists: [{ name: 'Artist', id: null }],
      duration_seconds: seconds,
    })),
  )
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/services/youtube/writer.test.js`:

```js
import { describe, expect, test, vi } from 'vitest'
import { executeReorder } from '../../plan/execute.js'
import { makeYouTubeTracks } from '../../test/factory.js'
import { createYouTubeWriter } from './writer.js'

/** A proxy client over an in-memory playlist, moving items as edit_playlist does. */
function fakeClient(items = []) {
  const state = { items: [...items] }
  return {
    state,
    moveItem: vi.fn(async (playlistId, setVideoId, beforeSetVideoId) => {
      const moving = state.items.find((item) => item.setVideoId === setVideoId)
      const rest = state.items.filter((item) => item !== moving)
      const at = beforeSetVideoId === null ? rest.length : rest.findIndex((item) => item.setVideoId === beforeSetVideoId)
      state.items = [...rest.slice(0, at), moving, ...rest.slice(at)]
    }),
    addItems: vi.fn(async (playlistId, videoIds) => videoIds.map((videoId) => ({ videoId, setVideoId: `new-${videoId}` }))),
    removeItems: vi.fn(async () => {}),
  }
}

describe('createYouTubeWriter', () => {
  test('a move sends the neutral form: this item, before that one', async () => {
    const client = fakeClient()
    await createYouTubeWriter(client).reorder(
      'PL1',
      { rangeStart: 3, insertBefore: 0, rangeLength: 1, key: 's3', beforeKey: 's0' },
      null,
    )
    expect(client.moveItem).toHaveBeenCalledWith('PL1', 's3', 's0')
  })

  test('executeReorder keyed by item id puts the playlist in the target order', async () => {
    const tracks = makeYouTubeTracks([{ videoId: 'a' }, { videoId: 'b' }, { videoId: 'c' }, { videoId: 'd' }])
    const client = fakeClient(tracks.map((track) => ({ videoId: track.id, setVideoId: track.itemId })))
    await executeReorder({
      writer: createYouTubeWriter(client),
      playlistId: 'PL1',
      currentTracks: tracks,
      targetTracks: [tracks[2], tracks[0], tracks[3], tracks[1]],
      snapshotId: null,
      keyOf: (track) => track.itemId,
    })
    expect(client.state.items.map((item) => item.videoId)).toEqual(['c', 'a', 'd', 'b'])
  })

  test('an add sends the tracks’ video ids and answers the ids they were given', async () => {
    const client = fakeClient()
    const added = await createYouTubeWriter(client).addTracks('PL1', makeYouTubeTracks([{ videoId: 'a' }, { videoId: 'b' }]))
    expect(added).toEqual([
      { videoId: 'a', setVideoId: 'new-a' },
      { videoId: 'b', setVideoId: 'new-b' },
    ])
    expect(client.addItems).toHaveBeenCalledWith('PL1', ['a', 'b'])
  })

  test('a removal sends only the two ids of each item', async () => {
    const client = fakeClient()
    await createYouTubeWriter(client).removeTracks('PL1', [{ videoId: 'a', setVideoId: 'sa', extra: 'x' }])
    expect(client.removeItems).toHaveBeenCalledWith('PL1', [{ videoId: 'a', setVideoId: 'sa' }])
  })
})
```

In `src/services/spotify/mutations.test.js`, change the import to:

```js
import { addTracksInChunks, createPlaylist, removeTracks, reorderTrack } from './mutations.js'
```

change the `recorder`'s last line to:

```js
  return { calls, post: record('POST'), put: record('PUT'), delete: record('DELETE') }
```

and append:

```js
describe('removeTracks', () => {
  test('removes every copy of each URI, in one request', async () => {
    const client = recorder()
    await removeTracks(client, 'p1', ['spotify:track:a', 'spotify:track:b'])
    expect(client.calls).toEqual([
      {
        method: 'DELETE',
        path: '/playlists/p1/items',
        body: { items: [{ uri: 'spotify:track:a' }, { uri: 'spotify:track:b' }] },
      },
    ])
  })
})
```

In `src/services/spotify/writer.test.js`, add to `fakeClient`'s returned object, after `post`:

```js
    delete: vi.fn(async (path, options) => {
      calls.push({ method: 'DELETE', path, body: options.body })
      return { snapshot_id: 'snap-next' }
    }),
```

and add this test inside `describe('createSpotifyWriter', …)`:

```js
  test('removeTracks sends the tracks’ URIs', async () => {
    const client = fakeClient()
    await createSpotifyWriter(client).removeTracks('p1', [{ uri: 'spotify:track:a' }])
    expect(client.calls[0]).toEqual({
      method: 'DELETE',
      path: '/playlists/p1/items',
      body: { items: [{ uri: 'spotify:track:a' }] },
    })
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/services`
Expected: FAIL. `./writer.js` does not exist under `youtube/`, `removeTracks` is not exported, and the Spotify writer has no `removeTracks`.

- [ ] **Step 4: Implement**

Create `src/services/youtube/writer.js`:

```js
/**
 * YouTube Music's implementation of the writer contract the planner depends
 * on (mirror run design §8). Each method sends one request; the mirror run
 * decides the batches.
 *
 * Items are addressed by setVideoId, the playlist-item id, so a move plan
 * keyed with `keyOf: (track) => track.itemId` passes straight through:
 * edit_playlist's own form is "move this item before that one" (mirror
 * design §4).
 */

export function createYouTubeWriter(client) {
  return {
    /** YouTube has no snapshot id, so a move takes no revision and returns none. */
    reorder(playlistId, op) {
      return client.moveItem(playlistId, op.key, op.beforeKey)
    },

    /** Answers `[{ videoId, setVideoId }]`, the ids YouTube gave the added items. */
    addTracks(playlistId, tracks) {
      return client.addItems(playlistId, tracks.map((track) => track.id))
    },

    /** `items` are `{ videoId, setVideoId }`, as the undo record holds them. */
    removeTracks(playlistId, items) {
      return client.removeItems(
        playlistId,
        items.map(({ videoId, setVideoId }) => ({ videoId, setVideoId })),
      )
    },
  }
}
```

In `src/services/spotify/mutations.js`, add after `addTracksInChunks`:

```js
/**
 * Remove every copy of each URI, at most 100 per call. Undo of a mirror run
 * is the only caller: it removes songs the run added, which the playlist did
 * not hold before (mirror run design §6). The body key is the one the probe
 * measured (§9).
 */
export async function removeTracks(client, playlistId, uris) {
  await client.delete(playlistItemsPath(playlistId), { body: { items: uris.map((uri) => ({ uri })) } })
}
```

In `src/services/spotify/writer.js`, change the import to:

```js
import { addTracksInChunks, createPlaylist, removeTracks, reorderTrack } from './mutations.js'
```

and add after `addTracks`:

```js
    /** Removes every copy of each track's URI; at most 100 per call. */
    removeTracks(playlistId, tracks) {
      return removeTracks(client, playlistId, tracks.map((track) => track.uri))
    },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/services`
Expected: PASS.

- [ ] **Step 6: Stage**

```bash
git add src/test/factory.js src/services/youtube/writer.js src/services/youtube/writer.test.js src/services/spotify/mutations.js src/services/spotify/mutations.test.js src/services/spotify/writer.js src/services/spotify/writer.test.js
```

---

### Task 6: The plan (pure)

**Files:**
- Create: `src/plan/mirror.js`
- Test: `src/plan/mirror.test.js`

**Interfaces:**
- Consumes:
  - `settlePairs` from `src/match/pairTracks.js`;
  - `setAsideMarked` and `settleFound` from `src/match/settleFound.js`;
  - `spotifyKeyOf` and `verdictLookup` from `src/match/matchBook.js`;
  - `buildMoveOps` from `./diff.js`.
- Produces:
  - `settleFromBook(spotifyTracks, youtubeTracks, book) → { pairs, unmatchedSpotify, unmatchedYoutube, counts, markedSpotify, markedYoutube }`. Only `same` verdicts pair, so every pair is `tier: 'certain'`.
  - `planFill(result) → { blocked: number, addToYoutube: Track[], addToSpotify: Track[] }`. `result` is any settled result: the review's, or `settleFromBook`'s.
  - `mirrorOrder(spotifyTracks, youtubeTracks, pairs) → Track[]`, a permutation of `youtubeTracks`.
  - `estimateMoves(spotifyTracks, youtubeTracks, result) → number`.
  - `sameItems(before, after, keyOf) → boolean`.

- [ ] **Step 1: Write the failing tests**

Create `src/plan/mirror.test.js`:

```js
import { describe, expect, test } from 'vitest'
import { snapshotOf } from '../match/matchBook.js'
import { makeTrack, makeTracks, makeUnavailable, makeYouTubeTracks } from '../test/factory.js'
import { buildMoveOps } from './diff.js'
import { estimateMoves, mirrorOrder, planFill, sameItems, settleFromBook } from './mirror.js'

const same = (spotifyKey, youtubeVideoId, found) => ({
  spotifyKey,
  youtubeVideoId,
  verdict: 'same',
  decidedAt: 1,
  ...(found ? { found } : {}),
})
const markSpotify = (spotifyKey) => ({ spotifyKey, youtubeVideoId: null, verdict: 'none', decidedAt: 1 })
const markYoutube = (youtubeVideoId) => ({ spotifyKey: null, youtubeVideoId, verdict: 'none', decidedAt: 1 })
const youtubeFind = (videoId) => snapshotOf(makeYouTubeTracks([{ videoId }])[0], 'youtube')
const spotifyFind = (id) => snapshotOf(makeTrack({ id, name: id }), 'spotify')
const ids = (tracks) => tracks.map((track) => track.id)

/**
 * Spotify A B C D; YouTube C A X E. A and C pair; B's YouTube twin and E's
 * Spotify twin are confirmed finds; D and X are marked.
 */
function settledPair() {
  const spotify = makeTracks([{ id: 'sA' }, { id: 'sB' }, { id: 'sC' }, { id: 'sD' }])
  const youtube = makeYouTubeTracks([{ videoId: 'yC' }, { videoId: 'yA' }, { videoId: 'yX' }, { videoId: 'yE' }])
  const book = [
    same('sA', 'yA'),
    same('sC', 'yC'),
    same('sB', 'yB', youtubeFind('yB')),
    same('sE', 'yE', spotifyFind('sE')),
    markSpotify('sD'),
    markYoutube('yX'),
  ]
  return { spotify, youtube, book }
}

describe('settleFromBook', () => {
  test('pairs only what the owner confirmed', () => {
    // An exact twin the matcher would call strong stays unmatched without a decision.
    const spotify = makeTracks([{ id: 'sA', name: 'Same Song' }])
    const youtube = makeYouTubeTracks([{ videoId: 'yA', title: 'Same Song' }])
    const result = settleFromBook(spotify, youtube, [])
    expect(result.pairs).toEqual([])
    expect(ids(result.unmatchedSpotify)).toEqual(['sA'])
  })

  test('a confirmed find is a certain pair, missing from the playlist that lacks it', () => {
    const { spotify, youtube, book } = settledPair()
    const result = settleFromBook(spotify, youtube, book)
    expect(result.pairs.every((pair) => pair.tier === 'certain')).toBe(true)
    expect(result.pairs.filter((pair) => pair.missingFrom === 'youtube').map((pair) => pair.youtube.id)).toEqual(['yB'])
    expect(result.pairs.filter((pair) => pair.missingFrom === 'spotify').map((pair) => pair.spotify.id)).toEqual(['sE'])
    expect(ids(result.markedSpotify)).toEqual(['sD'])
    expect(ids(result.markedYoutube)).toEqual(['yX'])
  })
})

describe('planFill', () => {
  test('nothing blocks a board the owner has settled', () => {
    const { spotify, youtube, book } = settledPair()
    expect(planFill(settleFromBook(spotify, youtube, book)).blocked).toBe(0)
  })

  test('counts every row still waiting: proposals, and unmatched songs on both sides', () => {
    const [a, b] = makeTracks([{ id: 'sA' }, { id: 'sB' }])
    const [y1, y2] = makeYouTubeTracks([{ videoId: 'y1' }, { videoId: 'y2' }])
    const result = {
      pairs: [
        { spotify: a, youtube: y1, tier: 'strong' },
        { spotify: b, youtube: y2, tier: 'likely' },
      ],
      unmatchedSpotify: makeTracks([{ id: 'sC' }]),
      unmatchedYoutube: makeYouTubeTracks([{ videoId: 'y3' }]),
    }
    expect(planFill(result).blocked).toBe(4)
  })

  test('a Spotify row with no track to key on does not block the run', () => {
    // Review Focus 1: a track Spotify no longer serves can be neither decided nor marked.
    const result = { pairs: [], unmatchedSpotify: [makeUnavailable(0)], unmatchedYoutube: [] }
    expect(planFill(result).blocked).toBe(0)
  })

  test('adds to YouTube in Spotify’s order, and to Spotify in YouTube’s order', () => {
    const spotify = makeTracks([{ id: 's1' }, { id: 's2' }])
    const youtube = makeYouTubeTracks([{ videoId: 'y1' }, { videoId: 'y2' }])
    const book = [
      same('s2', 'f2', youtubeFind('f2')),
      same('s1', 'f1', youtubeFind('f1')),
      same('g2', 'y2', spotifyFind('g2')),
      same('g1', 'y1', spotifyFind('g1')),
    ]
    const fill = planFill(settleFromBook(spotify, youtube, book))
    expect(ids(fill.addToYoutube)).toEqual(['f1', 'f2'])
    expect(ids(fill.addToSpotify)).toEqual(['g1', 'g2'])
  })

  test('a find the owner has not confirmed adds nothing', () => {
    const [song] = makeTracks([{ id: 's1' }])
    const [found] = makeYouTubeTracks([{ videoId: 'f1' }])
    const result = {
      pairs: [{ spotify: song, youtube: found, tier: 'strong', missingFrom: 'youtube' }],
      unmatchedSpotify: [],
      unmatchedYoutube: [],
    }
    expect(planFill(result).addToYoutube).toEqual([])
  })
})

describe('mirrorOrder', () => {
  test('YouTube follows Spotify, with songs in no pair at the bottom in their own order', () => {
    const { spotify, youtube, book } = settledPair()
    // As after the run's adds: B on YouTube, E on Spotify.
    const spotifyAfter = [...spotify, ...makeTracks([{ id: 'sE' }])]
    const youtubeAfter = [...youtube, ...makeYouTubeTracks([{ videoId: 'yB' }])]
    const { pairs } = settleFromBook(spotifyAfter, youtubeAfter, book)
    expect(ids(mirrorOrder(spotifyAfter, youtubeAfter, pairs))).toEqual(['yA', 'yB', 'yC', 'yE', 'yX'])
  })

  test('is always a permutation of the YouTube playlist', () => {
    const spotify = makeTracks(Array.from({ length: 12 }, (_, i) => ({ id: `s${i}` })))
    // y0 to y11, shuffled: 5 is coprime with 12.
    const youtube = makeYouTubeTracks(Array.from({ length: 12 }, (_, i) => ({ videoId: `y${(i * 5) % 12}` })))
    const book = [0, 3, 6, 9].map((i) => same(`s${i}`, `y${i}`))
    const order = mirrorOrder(spotify, youtube, settleFromBook(spotify, youtube, book).pairs)
    expect(order).toHaveLength(youtube.length)
    expect(new Set(order)).toEqual(new Set(youtube))
    expect(ids(order).slice(0, 4)).toEqual(['y0', 'y3', 'y6', 'y9'])
  })

  test('a song listed twice on Spotify puts its one YouTube copy at the first', () => {
    const spotify = makeTracks([{ id: 'sA' }, { id: 'sB' }, { id: 'sA' }])
    const youtube = makeYouTubeTracks([{ videoId: 'yB' }, { videoId: 'yA' }])
    const { pairs } = settleFromBook(spotify, youtube, [same('sA', 'yA'), same('sB', 'yB')])
    expect(ids(mirrorOrder(spotify, youtube, pairs))).toEqual(['yA', 'yB'])
  })

  test('a second YouTube copy of a song goes to the bottom', () => {
    const spotify = makeTracks([{ id: 'sA' }, { id: 'sB' }])
    const youtube = makeYouTubeTracks([
      { videoId: 'yA', setVideoId: 'first' },
      { videoId: 'yB' },
      { videoId: 'yA', setVideoId: 'second' },
    ])
    const { pairs } = settleFromBook(spotify, youtube, [same('sA', 'yA'), same('sB', 'yB')])
    expect(mirrorOrder(spotify, youtube, pairs).map((track) => track.itemId)).toEqual(['first', 'set-yB', 'second'])
  })

  test('a pair whose YouTube song is not in the playlist yet is left out', () => {
    const { spotify, youtube, book } = settledPair()
    // B's twin has not been added: the order holds only the playlist's own items.
    const { pairs } = settleFromBook(spotify, youtube, book)
    expect(ids(mirrorOrder(spotify, youtube, pairs))).toEqual(['yA', 'yC', 'yX', 'yE'])
  })
})

describe('estimateMoves', () => {
  test('none when YouTube already follows Spotify and nothing is to be added', () => {
    const spotify = makeTracks([{ id: 'sA' }, { id: 'sB' }])
    const youtube = makeYouTubeTracks([{ videoId: 'yA' }, { videoId: 'yB' }])
    const book = [same('sA', 'yA'), same('sB', 'yB')]
    expect(estimateMoves(spotify, youtube, settleFromBook(spotify, youtube, book))).toBe(0)
  })

  test('counts the moves with the songs to add placed at the end', () => {
    const { spotify, youtube, book } = settledPair()
    // YouTube C A X E, with B added at the end, ordered to A B C E X.
    expect(estimateMoves(spotify, youtube, settleFromBook(spotify, youtube, book))).toBe(
      buildMoveOps(['C', 'A', 'X', 'E', 'B'], ['A', 'B', 'C', 'E', 'X']).length,
    )
  })
})

describe('sameItems', () => {
  test('the same items in the same order, by the key given', () => {
    const tracks = makeTracks([{ id: 'a' }, { id: 'b' }])
    const byUri = (track) => track.uri
    expect(sameItems(tracks, [...tracks], byUri)).toBe(true)
    expect(sameItems(tracks, [tracks[1], tracks[0]], byUri)).toBe(false)
    expect(sameItems(tracks, tracks.slice(1), byUri)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/plan/mirror.test.js`
Expected: FAIL, because `./mirror.js` does not exist.

- [ ] **Step 3: Implement**

Create `src/plan/mirror.js`:

```js
/**
 * The mirror run's plan (docs/2026-10-11-mirror-run-design.md §4): what to
 * add to each playlist, and the order that makes YouTube follow Spotify.
 *
 * Pure module: no network, no storage. It is built from the matcher's own
 * steps, and only a human's `same` verdict pairs here, so every pair it acts
 * on is certain (D15). Because a run needs every row settled (D50), the
 * whole plan follows from the two playlists and the match book.
 */

import { spotifyKeyOf, verdictLookup } from '../match/matchBook.js'
import { settlePairs } from '../match/pairTracks.js'
import { setAsideMarked, settleFound } from '../match/settleFound.js'
import { buildMoveOps } from './diff.js'

/**
 * The two playlists settled from the match book alone. Nothing is scored, so
 * the only pairs are ones the owner confirmed. A song the owner has not
 * decided is left unmatched, where planFill counts it as blocking.
 */
export function settleFromBook(spotifyTracks, youtubeTracks, book) {
  const settled = settlePairs(spotifyTracks, youtubeTracks, [], { verdictFor: verdictLookup(book) })
  const aside = setAsideMarked(settled, book)
  return {
    ...settleFound(aside, { spotifyTracks, youtubeTracks, book }),
    markedSpotify: aside.markedSpotify,
    markedYoutube: aside.markedYoutube,
  }
}

/**
 * What a run adds, and how many rows still wait for the owner (§4, D50).
 *
 * @param {{pairs: Array, unmatchedSpotify: Array, unmatchedYoutube: Array}} result a settled result
 * @returns {{blocked: number, addToYoutube: Array, addToSpotify: Array}}
 */
export function planFill(result) {
  const certain = result.pairs.filter((pair) => pair.tier === 'certain')
  // A row with no key (a track Spotify no longer serves) can be neither
  // decided nor marked (M-3), so it waits on nothing; counting it would
  // block every run of that playlist.
  const blocked =
    result.pairs.length -
    certain.length +
    result.unmatchedSpotify.filter((track) => spotifyKeyOf(track) != null).length +
    result.unmatchedYoutube.filter((track) => track.id != null).length
  return {
    blocked,
    addToYoutube: certain
      .filter((pair) => pair.missingFrom === 'youtube')
      .sort(byPosition('spotify'))
      .map((pair) => pair.youtube),
    addToSpotify: certain
      .filter((pair) => pair.missingFrom === 'spotify')
      .sort(byPosition('youtube'))
      .map((pair) => pair.spotify),
  }
}

/**
 * The YouTube playlist in its target order (§4): down the Spotify playlist,
 * each song's paired YouTube item; then every YouTube item in no pair, in its
 * current relative order. Always a permutation of `youtubeTracks`. Pairs join
 * playlist items, not song ids, so a song listed twice on either side needs
 * no special case.
 */
export function mirrorOrder(spotifyTracks, youtubeTracks, pairs) {
  const twinOf = new Map(pairs.map((pair) => [pair.spotify, pair.youtube]))
  const inPlaylist = new Set(youtubeTracks)
  const placed = new Set()
  const order = []
  for (const track of spotifyTracks) {
    const twin = twinOf.get(track)
    if (!twin || !inPlaylist.has(twin) || placed.has(twin)) continue
    placed.add(twin)
    order.push(twin)
  }
  return [...order, ...youtubeTracks.filter((track) => !placed.has(track))]
}

/**
 * The preview's move count (§4). The songs to add stand in at the end of
 * YouTube, wherever YouTube will really put them, so the count is exact only
 * when nothing is added. A stand-in is keyed by its videoId, which no
 * playlist item id can equal.
 */
export function estimateMoves(spotifyTracks, youtubeTracks, result) {
  const { addToYoutube, addToSpotify } = planFill(result)
  const pairs = result.pairs.filter((pair) => pair.tier === 'certain')
  const youtubeAfter = [...youtubeTracks, ...addToYoutube]
  const keyOf = (track) => track.itemId ?? `new:${track.id}`
  const target = mirrorOrder([...spotifyTracks, ...addToSpotify], youtubeAfter, pairs)
  return buildMoveOps(youtubeAfter.map(keyOf), target.map(keyOf)).length
}

/** Whether two reads of a playlist hold the same items in the same order (§5, step 1). */
export function sameItems(before, after, keyOf) {
  return before.length === after.length && before.every((track, index) => keyOf(track) === keyOf(after[index]))
}

const byPosition = (side) => (a, b) => a[side].originalIndex - b[side].originalIndex
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/plan/mirror.test.js`
Expected: PASS.

- [ ] **Step 5: Stage**

```bash
git add src/plan/mirror.js src/plan/mirror.test.js
```

---

### Task 7: The undo record

**Files:**
- Modify: `src/plan/undo.js`
- Test: `src/plan/undo.test.js`

**Interfaces:**
- Produces:
  - `buildRestoreOrder(currentTracks, snapshot, keyOf = (track) => track.uri)`. It still reads `snapshot.uris`; the mirror passes `{ uris: record.orderBefore }` with `(track) => track.id`.
  - `startMirrorRecord(prior, { youtubePlaylistId, spotifyPlaylistId, youtubeTracks }, now = Date.now())` → a record of shape `{ version: 1, youtubePlaylistId, spotifyPlaylistId, orderBefore: [videoId], addedToYoutube: [{videoId, setVideoId}], addedToSpotify: [uri], finished: false, createdAt }`. It returns `prior` itself when that is unfinished and for the same two playlists (D54).
  - `saveMirrorRecord(record, storage) → boolean`
  - `loadMirrorRecord(youtubePlaylistId, storage) → record | null`
  - `clearMirrorRecord(youtubePlaylistId, storage)`
  - The storage key is `playlist-sorter:mirror-undo:<youtubePlaylistId>`.

- [ ] **Step 1: Write the failing tests**

In `src/plan/undo.test.js`, change the imports to:

```js
import { describe, expect, test } from 'vitest'
import { makeTracks, makeYouTubeTracks } from '../test/factory.js'
import {
  buildRestoreOrder,
  clearMirrorRecord,
  clearSnapshot,
  createSnapshot,
  loadMirrorRecord,
  loadSnapshot,
  saveMirrorRecord,
  saveSnapshot,
  startMirrorRecord,
} from './undo.js'
```

Append to the end of the file:

```js
describe('buildRestoreOrder by another key', () => {
  test('restores a YouTube playlist by video id, with anything newer at the bottom', () => {
    const tracks = makeYouTubeTracks([{ videoId: 'c' }, { videoId: 'a' }, { videoId: 'new' }, { videoId: 'b' }])
    const restored = buildRestoreOrder(tracks, { uris: ['a', 'b', 'c'] }, (track) => track.id)
    expect(restored.map((track) => track.id)).toEqual(['a', 'b', 'c', 'new'])
  })
})

describe('the mirror undo record', () => {
  const youtubeTracks = makeYouTubeTracks([{ videoId: 'y1' }, { videoId: 'y2' }])
  const playlists = { youtubePlaylistId: 'yt', spotifyPlaylistId: 'sp', youtubeTracks }

  test('starts from YouTube’s order now, with nothing added', () => {
    expect(startMirrorRecord(null, playlists, 5)).toEqual({
      version: 1,
      youtubePlaylistId: 'yt',
      spotifyPlaylistId: 'sp',
      orderBefore: ['y1', 'y2'],
      addedToYoutube: [],
      addedToSpotify: [],
      finished: false,
      createdAt: 5,
    })
  })

  test('carries an unfinished record for the same playlists forward (D54)', () => {
    const prior = { ...startMirrorRecord(null, playlists, 1), orderBefore: ['old'], addedToSpotify: ['spotify:track:x'] }
    expect(startMirrorRecord(prior, playlists, 5)).toBe(prior)
  })

  test('starts afresh after a finished run', () => {
    const prior = { ...startMirrorRecord(null, playlists, 1), orderBefore: ['old'], finished: true }
    expect(startMirrorRecord(prior, playlists, 5).orderBefore).toEqual(['y1', 'y2'])
  })

  test('starts afresh for another Spotify playlist, so two are never mixed', () => {
    const prior = { ...startMirrorRecord(null, playlists, 1), orderBefore: ['old'] }
    expect(startMirrorRecord(prior, { ...playlists, spotifyPlaylistId: 'other' }, 5).orderBefore).toEqual(['y1', 'y2'])
  })

  test('round-trips through storage, filed under the YouTube playlist', () => {
    const storage = memoryStorage()
    const record = startMirrorRecord(null, playlists, 5)
    expect(saveMirrorRecord(record, storage)).toBe(true)
    expect(storage.store.has('playlist-sorter:mirror-undo:yt')).toBe(true)
    expect(loadMirrorRecord('yt', storage)).toEqual(record)
    clearMirrorRecord('yt', storage)
    expect(loadMirrorRecord('yt', storage)).toBeNull()
  })

  test('a blocked store saves nothing, reads as no record, and never throws', () => {
    const refuse = () => {
      throw new Error('blocked')
    }
    const blocked = { getItem: refuse, setItem: refuse, removeItem: refuse }
    expect(saveMirrorRecord(startMirrorRecord(null, playlists, 5), blocked)).toBe(false)
    expect(loadMirrorRecord('yt', blocked)).toBeNull()
    expect(() => clearMirrorRecord('yt', blocked)).not.toThrow()
  })

  test('a record of another version reads as no record', () => {
    const storage = memoryStorage()
    storage.setItem('playlist-sorter:mirror-undo:yt', JSON.stringify({ version: 99 }))
    expect(loadMirrorRecord('yt', storage)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/plan/undo.test.js`
Expected: FAIL. `startMirrorRecord` is not exported, and the restore by video id comes back in the wrong order.

- [ ] **Step 3: Implement**

In `src/plan/undo.js`, replace the `buildRestoreOrder` signature and its two `track.uri` reads. Replace:

```js
export function buildRestoreOrder(currentTracks, snapshot) {
  const available = new Map()
  currentTracks.forEach((track, index) => {
    const queue = available.get(track.uri)
    if (queue) queue.push(index)
    else available.set(track.uri, [index])
  })
```

with:

```js
export function buildRestoreOrder(currentTracks, snapshot, keyOf = (track) => track.uri) {
  // The mirror run restores YouTube by videoId (mirror run design §6), giving
  // its record's `orderBefore` as `snapshot.uris`.
  const available = new Map()
  currentTracks.forEach((track, index) => {
    const key = keyOf(track)
    const queue = available.get(key)
    if (queue) queue.push(index)
    else available.set(key, [index])
  })
```

Then append to the end of the file:

```js
const MIRROR_PREFIX = 'playlist-sorter:mirror-undo:'
const MIRROR_VERSION = 1

/**
 * The undo record a mirror run writes against (mirror run design §6). An
 * unfinished record for the same two playlists carries forward, so Undo after
 * stopping and running again reaches back to before the first attempt (D54).
 * Anything else starts afresh from YouTube's order now.
 */
export function startMirrorRecord(prior, { youtubePlaylistId, spotifyPlaylistId, youtubeTracks }, now = Date.now()) {
  if (
    prior &&
    !prior.finished &&
    prior.youtubePlaylistId === youtubePlaylistId &&
    prior.spotifyPlaylistId === spotifyPlaylistId
  ) {
    return prior
  }
  return {
    version: MIRROR_VERSION,
    youtubePlaylistId,
    spotifyPlaylistId,
    orderBefore: youtubeTracks.map((track) => track.id),
    addedToYoutube: [],
    addedToSpotify: [],
    finished: false,
    createdAt: now,
  }
}

/** False when the browser refuses; the record then lives only in memory (§6). */
export function saveMirrorRecord(record, storage = globalThis.localStorage) {
  try {
    storage.setItem(MIRROR_PREFIX + record.youtubePlaylistId, JSON.stringify(record))
    return true
  } catch {
    return false
  }
}

export function loadMirrorRecord(youtubePlaylistId, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(MIRROR_PREFIX + youtubePlaylistId)
    const record = raw ? JSON.parse(raw) : null
    return record?.version === MIRROR_VERSION ? record : null
  } catch {
    return null
  }
}

export function clearMirrorRecord(youtubePlaylistId, storage = globalThis.localStorage) {
  try {
    storage?.removeItem(MIRROR_PREFIX + youtubePlaylistId)
  } catch {
    // See saveSnapshot.
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/plan/undo.test.js`
Expected: PASS, including every test that was there before.

- [ ] **Step 5: Stage**

```bash
git add src/plan/undo.js src/plan/undo.test.js
```

---

### Task 8: The run

**Files:**
- Create: `src/plan/executeMirror.js`
- Test: `src/plan/executeMirror.test.js`

**Interfaces:**
- Consumes:
  - from Task 6: `settleFromBook`, `planFill`, `mirrorOrder`, `sameItems`;
  - from Task 7: `startMirrorRecord`, `buildRestoreOrder` (in Task 9);
  - `executeReorder` and `ReorderFailure` from `./execute.js`;
  - Task 5's writer contract.
- Produces:
  - `SPOTIFY_CHUNK = 100`
  - `YOUTUBE_CHUNK = 50`, or what Task 3 measured.
  - `class MirrorFailure extends Error { report }`
  - `executeMirror(args)` with:
    - **args:** `{ spotifyPlaylistId, youtubePlaylistId, spotifyEditable, readSpotify, readYoutube, spotifyWriter, youtubeWriter, book, previewed: { spotifyTracks, youtubeTracks }, reorder = true, priorRecord = null, onRecord, onPhase?, signal? }`.
    - **resolves to** `{ kind: 'stale' }` or `{ kind: 'done' | 'stopped', addedToYoutube, addedToSpotify, applied, total, matches: boolean | null, unpaired: Track[] }`.
    - **rejects with** `MirrorFailure`.
    - **`onPhase` names:** `guard`, `addingSpotify`, `addingYoutube`, `reading`, `moving`, `verifying`.

- [ ] **Step 1: Write the failing tests**

Create `src/plan/executeMirror.test.js`:

```js
import { describe, expect, test, vi } from 'vitest'
import { snapshotOf } from '../match/matchBook.js'
import { makeTrack, makeTracks, makeYouTubeTracks } from '../test/factory.js'
import { executeMirror, MirrorFailure } from './executeMirror.js'

const same = (spotifyKey, youtubeVideoId, found) => ({
  spotifyKey,
  youtubeVideoId,
  verdict: 'same',
  decidedAt: 1,
  ...(found ? { found } : {}),
})
const markSpotify = (spotifyKey) => ({ spotifyKey, youtubeVideoId: null, verdict: 'none', decidedAt: 1 })
const markYoutube = (youtubeVideoId) => ({ spotifyKey: null, youtubeVideoId, verdict: 'none', decidedAt: 1 })
const youtubeFind = (videoId) => snapshotOf(makeYouTubeTracks([{ videoId }])[0], 'youtube')
const spotifyFind = (id) => snapshotOf(makeTrack({ id, name: id }), 'spotify')
const ids = (tracks) => tracks.map((track) => track.id)

/**
 * Two in-memory playlists, with readers and writers that act on them as the
 * services do. Options make YouTube misbehave in the ways the spec names.
 */
function world({
  spotify,
  youtube,
  addToTop = false,
  reissueOnAdd = false,
  ignoreMoves = false,
  substitute = {},
  failYoutubeAddAt = 0,
  onYoutubeAdd,
}) {
  let next = 0
  const state = { spotify: [...spotify], youtube: [...youtube] }
  const log = []
  const renumber = (list) => list.map((track, index) => ({ ...track, originalIndex: index }))
  const youtubeWriter = {
    addTracks: vi.fn(async (playlistId, tracks) => {
      log.push('youtube.add')
      if (youtubeWriter.addTracks.mock.calls.length === failYoutubeAddAt) {
        throw new Error('YouTube Music refused the addition.')
      }
      const rows = tracks.map((track) => {
        const videoId = substitute[track.id] ?? track.id
        return { ...track, id: videoId, itemId: `new-${videoId}-${++next}`, source: 'youtube' }
      })
      if (reissueOnAdd) state.youtube = state.youtube.map((track) => ({ ...track, itemId: `re-${track.id}-${++next}` }))
      state.youtube = addToTop ? [...rows, ...state.youtube] : [...state.youtube, ...rows]
      onYoutubeAdd?.()
      return rows.map((row) => ({ videoId: row.id, setVideoId: row.itemId }))
    }),
    reorder: vi.fn(async (playlistId, op) => {
      log.push('youtube.move')
      const known = new Set(state.youtube.map((track) => track.itemId))
      if (!known.has(op.key) || (op.beforeKey !== null && !known.has(op.beforeKey))) {
        throw new Error(`No item ${op.key} or ${op.beforeKey} in the playlist`)
      }
      if (ignoreMoves) return
      const moving = state.youtube.find((track) => track.itemId === op.key)
      const rest = state.youtube.filter((track) => track !== moving)
      const at = op.beforeKey === null ? rest.length : rest.findIndex((track) => track.itemId === op.beforeKey)
      state.youtube = [...rest.slice(0, at), moving, ...rest.slice(at)]
    }),
    removeTracks: vi.fn(async (playlistId, items) => {
      log.push('youtube.remove')
      const gone = new Set(items.map((item) => item.setVideoId))
      state.youtube = state.youtube.filter((track) => !gone.has(track.itemId))
    }),
  }
  const spotifyWriter = {
    addTracks: vi.fn(async (playlistId, tracks) => {
      log.push('spotify.add')
      state.spotify = [...state.spotify, ...tracks]
    }),
    removeTracks: vi.fn(async (playlistId, tracks) => {
      log.push('spotify.remove')
      const gone = new Set(tracks.map((track) => track.uri))
      state.spotify = state.spotify.filter((track) => !gone.has(track.uri))
    }),
  }
  return {
    state,
    log,
    spotifyWriter,
    youtubeWriter,
    readSpotify: async () => renumber(state.spotify),
    readYoutube: async () => renumber(state.youtube),
  }
}

/**
 * Spotify A B C D; YouTube C A X E. A and C pair; B's YouTube twin and E's
 * Spotify twin are confirmed finds; D and X are marked. Done, YouTube reads
 * A B C E X and Spotify A B C D E.
 */
function scenario(options = {}) {
  const spotify = makeTracks([{ id: 'sA' }, { id: 'sB' }, { id: 'sC' }, { id: 'sD' }])
  const youtube = makeYouTubeTracks([{ videoId: 'yC' }, { videoId: 'yA' }, { videoId: 'yX' }, { videoId: 'yE' }])
  const book = [
    same('sA', 'yA'),
    same('sC', 'yC'),
    same('sB', 'yB', youtubeFind('yB')),
    same('sE', 'yE', spotifyFind('sE')),
    markSpotify('sD'),
    markYoutube('yX'),
  ]
  return { ...world({ spotify, youtube, ...options }), book, previewed: { spotifyTracks: spotify, youtubeTracks: youtube } }
}

/** 51 Spotify songs whose YouTube twins are all finds: two YouTube chunks. */
function bigScenario(options = {}) {
  const spotify = makeTracks(Array.from({ length: 51 }, (_, i) => ({ id: `s${i}` })))
  const book = spotify.map((track, i) => same(track.id, `y${i}`, youtubeFind(`y${i}`)))
  return { ...world({ spotify, youtube: [], ...options }), book, previewed: { spotifyTracks: spotify, youtubeTracks: [] } }
}

async function run(s, overrides = {}) {
  const records = []
  const result = await executeMirror({
    spotifyPlaylistId: 'sp',
    youtubePlaylistId: 'yt',
    spotifyEditable: true,
    readSpotify: s.readSpotify,
    readYoutube: s.readYoutube,
    spotifyWriter: s.spotifyWriter,
    youtubeWriter: s.youtubeWriter,
    book: s.book,
    previewed: s.previewed,
    onRecord: (record) => {
      records.push(record)
      s.log.push('record')
    },
    ...overrides,
  })
  return { result, records }
}

/** Run expecting a MirrorFailure; answers it with the records written. */
async function runFailing(s, overrides = {}) {
  const records = []
  try {
    await run(s, { onRecord: (record) => records.push(record), ...overrides })
  } catch (failure) {
    expect(failure).toBeInstanceOf(MirrorFailure)
    return { failure, records }
  }
  throw new Error('expected the run to fail')
}

describe('executeMirror', () => {
  test('adds the finds to both playlists and puts YouTube in Spotify’s order', async () => {
    const s = scenario()
    const { result } = await run(s)
    expect(ids(s.state.spotify)).toEqual(['sA', 'sB', 'sC', 'sD', 'sE'])
    expect(ids(s.state.youtube)).toEqual(['yA', 'yB', 'yC', 'yE', 'yX'])
    expect(result).toMatchObject({ kind: 'done', addedToYoutube: 1, addedToSpotify: 1, matches: true, unpaired: [] })
  })

  test('saves the undo record before the first write, and grows it as each request lands', async () => {
    const s = scenario()
    const { records } = await run(s)
    expect(s.log.slice(0, 2)).toEqual(['record', 'spotify.add'])
    expect(records[0]).toMatchObject({ orderBefore: ['yC', 'yA', 'yX', 'yE'], addedToYoutube: [], addedToSpotify: [] })
    expect(records[1].addedToSpotify).toEqual(['spotify:track:sE'])
    expect(records[2].addedToYoutube).toEqual([{ videoId: 'yB', setVideoId: 'new-yB-1' }])
    expect(records.at(-1).finished).toBe(true)
  })

  test('writes nothing when a playlist changed since the preview', async () => {
    // Review Focus 3: E was added to YouTube by hand after the preview was built.
    const s = scenario()
    s.previewed = { ...s.previewed, youtubeTracks: s.previewed.youtubeTracks.slice(0, 3) }
    const { result, records } = await run(s)
    expect(result).toEqual({ kind: 'stale' })
    expect(s.log).toEqual([])
    expect(records).toEqual([])
  })

  test('refuses to add to a Spotify playlist the owner cannot edit, before any write', async () => {
    // Review Focus 4: reached without the panel's own check.
    const s = scenario()
    const { failure, records } = await runFailing(s, { spotifyEditable: false })
    expect(failure.message).toBe('This Spotify playlist isn’t yours to add to.')
    expect(s.log).toEqual([])
    expect(records).toEqual([])
  })

  test('no move names an item id from before the adds, even when YouTube reissues them all', async () => {
    // Mirror design §12: the corruption case, asserted directly.
    const s = scenario({ reissueOnAdd: true })
    await run(s)
    const keys = s.youtubeWriter.reorder.mock.calls.flatMap(([, op]) => [op.key, op.beforeKey]).filter(Boolean)
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.every((key) => /^(re|new)-/.test(key))).toBe(true)
    expect(ids(s.state.youtube)).toEqual(['yA', 'yB', 'yC', 'yE', 'yX'])
  })

  test('a playlist that adds new songs at the top still ends in Spotify’s order', async () => {
    // Review Focus 2.
    const s = scenario({ addToTop: true })
    const { result } = await run(s)
    expect(ids(s.state.youtube)).toEqual(['yA', 'yB', 'yC', 'yE', 'yX'])
    expect(result.matches).toBe(true)
  })

  test('with reordering off, adds and leaves the order alone', async () => {
    const s = scenario()
    const { result, records } = await run(s, { reorder: false })
    expect(s.youtubeWriter.reorder).not.toHaveBeenCalled()
    expect(ids(s.state.youtube)).toEqual(['yC', 'yA', 'yX', 'yE', 'yB'])
    expect(result).toMatchObject({ kind: 'done', matches: null })
    expect(records.at(-1).finished).toBe(true)
  })

  test('stops between requests, leaving the record unfinished', async () => {
    const controller = new AbortController()
    const s = scenario({ onYoutubeAdd: () => controller.abort() })
    const { result, records } = await run(s, { signal: controller.signal })
    expect(result).toMatchObject({ kind: 'stopped', addedToYoutube: 1 })
    expect(s.youtubeWriter.reorder).not.toHaveBeenCalled()
    expect(records.at(-1).finished).toBe(false)
  })

  test('a failed add reports how far it got, and the record holds only what landed', async () => {
    // Review Focus 5: the second YouTube request of two is refused.
    const s = bigScenario({ failYoutubeAddAt: 2 })
    const { failure, records } = await runFailing(s)
    expect(failure.message).toBe('Added 50 to YouTube and 0 to Spotify. Then: YouTube Music refused the addition.')
    expect(failure.report.addedToYoutube).toBe(50)
    expect(records.at(-1).addedToYoutube).toHaveLength(50)
    expect(records.at(-1).finished).toBe(false)
  })

  test('says so when YouTube shows a different order than the one written', async () => {
    const s = scenario({ ignoreMoves: true })
    const { result } = await run(s)
    expect(result.matches).toBe(false)
  })

  test('names a song that was added but did not pair, and sends it to the bottom', async () => {
    // YouTube answered the add with another video than the one asked for.
    const s = scenario({ substitute: { yB: 'yB2' } })
    const { result } = await run(s)
    expect(ids(result.unpaired)).toEqual(['yB2'])
    expect(ids(s.state.youtube)).toEqual(['yA', 'yC', 'yE', 'yX', 'yB2'])
  })

  test('carries an unfinished record forward (D54)', async () => {
    const s = scenario()
    const prior = {
      version: 1,
      youtubePlaylistId: 'yt',
      spotifyPlaylistId: 'sp',
      orderBefore: ['old'],
      addedToYoutube: [{ videoId: 'yQ', setVideoId: 'q' }],
      addedToSpotify: [],
      finished: false,
      createdAt: 1,
    }
    const { records } = await run(s, { priorRecord: prior })
    expect(records[0]).toBe(prior)
    expect(records.at(-1).orderBefore).toEqual(['old'])
    expect(records.at(-1).addedToYoutube.map((entry) => entry.videoId)).toEqual(['yQ', 'yB'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/plan/executeMirror.test.js`
Expected: FAIL, because `./executeMirror.js` does not exist.

- [ ] **Step 3: Implement**

Create `src/plan/executeMirror.js`. If Task 3 measured a different chunk size, use it for `YOUTUBE_CHUNK`.

```js
/**
 * The mirror run and its undo (docs/2026-10-11-mirror-run-design.md §5–6).
 *
 * Everything that touches a service is injected — two readers and two
 * writers — and so is where the undo record goes, so the whole sequence
 * tests against fakes. Requests go one at a time, and Stop is honoured
 * between them.
 */

import { executeReorder, ReorderFailure } from './execute.js'
import { mirrorOrder, planFill, sameItems, settleFromBook } from './mirror.js'
import { startMirrorRecord } from './undo.js'

/** Spotify's limit per request. */
export const SPOTIFY_CHUNK = 100
/** Not published by YouTube; the probe measured 50 accepted (§9). */
export const YOUTUBE_CHUNK = 50

const byUri = (track) => track.uri
const byItem = (track) => track.itemId

/** A run or an undo that stopped on an error. `report` says how far it got. */
export class MirrorFailure extends Error {
  constructor(message, { report, cause } = {}) {
    super(message, { cause })
    this.name = 'MirrorFailure'
    this.report = report
  }
}

/**
 * @param {object} args
 * @param {string} args.spotifyPlaylistId
 * @param {string} args.youtubePlaylistId
 * @param {boolean} args.spotifyEditable whether the owner may add to the Spotify playlist
 * @param {() => Promise<Array>} args.readSpotify the Spotify playlist's Tracks, as it is now
 * @param {() => Promise<Array>} args.readYoutube the YouTube playlist's Tracks, as it is now
 * @param {object} args.spotifyWriter
 * @param {object} args.youtubeWriter
 * @param {Array} args.book the match book
 * @param {{spotifyTracks: Array, youtubeTracks: Array}} args.previewed what the preview was built from
 * @param {boolean} [args.reorder] D51's toggle
 * @param {object|null} [args.priorRecord] the undo record held now, if any
 * @param {(record: object) => void} args.onRecord every new state of the undo record
 * @param {(phase: string, done?: number, total?: number) => void} [args.onPhase]
 * @param {AbortSignal} [args.signal]
 */
export async function executeMirror({
  spotifyPlaylistId,
  youtubePlaylistId,
  spotifyEditable,
  readSpotify,
  readYoutube,
  spotifyWriter,
  youtubeWriter,
  book,
  previewed,
  reorder = true,
  priorRecord = null,
  onRecord,
  onPhase,
  signal,
}) {
  const report = { addedToSpotify: 0, addedToYoutube: 0, applied: 0, total: 0 }
  const stopped = () => signal?.aborted === true
  const halt = () => ({ kind: 'stopped', ...report, matches: null, unpaired: [] })

  // 1. Guard: write nothing into a playlist that moved since the preview.
  onPhase?.('guard')
  const [spotifyNow, youtubeNow] = await Promise.all([readSpotify(), readYoutube()])
  if (
    !sameItems(previewed.spotifyTracks, spotifyNow, byUri) ||
    !sameItems(previewed.youtubeTracks, youtubeNow, byItem)
  ) {
    return { kind: 'stale' }
  }
  const fill = planFill(settleFromBook(spotifyNow, youtubeNow, book))
  // The panel refuses both of these first, but no write path may assume it
  // was only ever reached from a lit lever.
  if (fill.blocked > 0) throw new MirrorFailure(`Settle ${fill.blocked} more songs first.`, { report })
  if (fill.addToSpotify.length > 0 && !spotifyEditable) {
    throw new MirrorFailure('This Spotify playlist isn’t yours to add to.', { report })
  }

  // 2. The undo record, saved before the first write (§6, D54).
  let record = startMirrorRecord(priorRecord, { youtubePlaylistId, spotifyPlaylistId, youtubeTracks: youtubeNow })
  onRecord(record)

  try {
    // 3. Spotify's additions go to its end (D49).
    for (const chunk of chunksOf(fill.addToSpotify, SPOTIFY_CHUNK)) {
      if (stopped()) return halt()
      onPhase?.('addingSpotify', report.addedToSpotify, fill.addToSpotify.length)
      await spotifyWriter.addTracks(spotifyPlaylistId, chunk)
      record = { ...record, addedToSpotify: [...record.addedToSpotify, ...chunk.map(byUri)] }
      onRecord(record)
      report.addedToSpotify += chunk.length
    }

    // 4. YouTube's land wherever YouTube puts them; step 6 orders them.
    const landedIds = new Set()
    for (const chunk of chunksOf(fill.addToYoutube, YOUTUBE_CHUNK)) {
      if (stopped()) return halt()
      onPhase?.('addingYoutube', report.addedToYoutube, fill.addToYoutube.length)
      const landed = await youtubeWriter.addTracks(youtubePlaylistId, chunk)
      for (const { videoId } of landed) landedIds.add(videoId)
      record = {
        ...record,
        addedToYoutube: [
          ...record.addedToYoutube,
          ...landed.map(({ videoId, setVideoId }) => ({ videoId, setVideoId })),
        ],
      }
      onRecord(record)
      report.addedToYoutube += chunk.length
    }
    if (stopped()) return halt()

    // 5. Re-read both and pair again. Every move below names an item id read
    // after the adds, never one from before them (mirror design §10).
    onPhase?.('reading')
    const [spotifyAfter, youtubeAfter] = await Promise.all([readSpotify(), readYoutube()])
    const settled = settleFromBook(spotifyAfter, youtubeAfter, book)
    const target = mirrorOrder(spotifyAfter, youtubeAfter, settled.pairs)
    const addedUris = new Set(fill.addToSpotify.map(byUri))
    const unpaired = [
      ...settled.unmatchedSpotify.filter((track) => addedUris.has(track.uri)),
      ...settled.unmatchedYoutube.filter((track) => landedIds.has(track.id)),
    ]

    // 6. Reorder (D51's toggle), one move per request; then 7, check (D53).
    let matches = null
    if (reorder) {
      onPhase?.('moving', 0, 0)
      const moved = await executeReorder({
        writer: youtubeWriter,
        playlistId: youtubePlaylistId,
        currentTracks: youtubeAfter,
        targetTracks: target,
        snapshotId: null,
        keyOf: byItem,
        signal,
        onProgress: (done, total) => {
          report.applied = done
          report.total = total
          onPhase?.('moving', done, total)
        },
      })
      report.applied = moved.applied
      report.total = moved.ops.length
      if (moved.cancelled) return halt()

      onPhase?.('verifying')
      matches = sameItems(target, await readYoutube(), byItem)
    }

    record = { ...record, finished: true }
    onRecord(record)
    return { kind: 'done', ...report, matches, unpaired }
  } catch (cause) {
    throw failure(`Added ${report.addedToYoutube} to YouTube and ${report.addedToSpotify} to Spotify.`, report, cause)
  }
}

/** How far a run or an undo got, then what stopped it (§5). */
function failure(done, report, cause) {
  const reorder = cause instanceof ReorderFailure
  const moves = reorder ? { applied: cause.applied, total: cause.ops.length } : report
  const reason = reorder ? (cause.cause?.message ?? cause.message) : cause.message
  const moved = moves.total > 0 ? ` Moved ${moves.applied} of ${moves.total}.` : ''
  return new MirrorFailure(`${done}${moved} Then: ${reason}`, {
    report: { ...report, applied: moves.applied, total: moves.total },
    cause,
  })
}

function chunksOf(list, size) {
  const chunks = []
  for (let start = 0; start < list.length; start += size) chunks.push(list.slice(start, start + size))
  return chunks
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/plan/executeMirror.test.js`
Expected: PASS.

- [ ] **Step 5: Stage**

```bash
git add src/plan/executeMirror.js src/plan/executeMirror.test.js
```

---

### Task 9: The undo

**Files:**
- Modify: `src/plan/executeMirror.js`
- Test: `src/plan/executeMirror.test.js`

**Interfaces:**
- Consumes: Task 8's file and test helpers; `buildRestoreOrder` (Task 7).
- Produces:
  - `undoMirror({ record, readYoutube, spotifyWriter, youtubeWriter, onRecord, onPhase?, signal? })`:
    - **resolves to** `{ kind: 'undone' | 'undoStopped', removedFromYoutube, removedFromSpotify, applied, total }`;
    - **rejects with** `MirrorFailure`;
    - calls `onRecord(null)` once everything succeeds;
    - **`onPhase` names:** `removingYoutube`, `removingSpotify`, `restoring`.
  - `resolveAdditions(tracks, entries) → { found: Array<{entry, item: {videoId, setVideoId}}>, gone: entries }`

- [ ] **Step 1: Write the failing tests**

In `src/plan/executeMirror.test.js`, change the import to:

```js
import { executeMirror, MirrorFailure, undoMirror } from './executeMirror.js'
```

Append to the end of the file:

```js
async function undo(s, record, overrides = {}) {
  const records = []
  const result = await undoMirror({
    record,
    readYoutube: s.readYoutube,
    spotifyWriter: s.spotifyWriter,
    youtubeWriter: s.youtubeWriter,
    onRecord: (next) => records.push(next),
    ...overrides,
  })
  return { result, records }
}

describe('undoMirror', () => {
  test('removes what the run added, from both playlists, and puts YouTube’s order back', async () => {
    const s = scenario()
    const { records: ran } = await run(s)
    const { result, records } = await undo(s, ran.at(-1))
    expect(ids(s.state.spotify)).toEqual(['sA', 'sB', 'sC', 'sD'])
    expect(ids(s.state.youtube)).toEqual(['yC', 'yA', 'yX', 'yE'])
    expect(result).toMatchObject({ kind: 'undone', removedFromYoutube: 1, removedFromSpotify: 1 })
    expect(records.at(-1)).toBeNull()
  })

  test('leaves a copy of the same song the owner added by hand', async () => {
    const s = scenario()
    const { records: ran } = await run(s)
    const [yB] = makeYouTubeTracks([{ videoId: 'yB', setVideoId: 'by-hand' }])
    s.state.youtube = [...s.state.youtube, yB]
    await undo(s, ran.at(-1))
    expect(s.state.youtube.map((track) => track.itemId)).toEqual(['set-yC', 'set-yA', 'set-yX', 'set-yE', 'by-hand'])
  })

  test('finds an addition by its video id when YouTube reissued its item id', async () => {
    const s = scenario()
    const { records: ran } = await run(s)
    s.state.youtube = s.state.youtube.map((track) => ({ ...track, itemId: `later-${track.id}` }))
    await undo(s, ran.at(-1))
    expect(ids(s.state.youtube)).toEqual(['yC', 'yA', 'yX', 'yE'])
  })

  test('an addition the owner already removed by hand costs no request', async () => {
    const s = scenario()
    const { records: ran } = await run(s)
    s.state.youtube = s.state.youtube.filter((track) => track.id !== 'yB')
    const { records } = await undo(s, ran.at(-1))
    expect(s.youtubeWriter.removeTracks).not.toHaveBeenCalled()
    expect(records[0].addedToYoutube).toEqual([])
  })

  test('a stopped undo keeps a record of exactly what is left to remove', async () => {
    const s = bigScenario()
    const { records: ran } = await run(s)
    const controller = new AbortController()
    const remove = s.youtubeWriter.removeTracks
    s.youtubeWriter.removeTracks = vi.fn(async (...args) => {
      await remove(...args)
      controller.abort()
    })
    const { result, records } = await undo(s, ran.at(-1), { signal: controller.signal })
    expect(result.kind).toBe('undoStopped')
    expect(records.at(-1).addedToYoutube).toHaveLength(1)
    expect(s.state.youtube).toHaveLength(1)
  })

  test('a failed Spotify removal keeps the record of what is still there', async () => {
    const s = scenario()
    const { records: ran } = await run(s)
    s.spotifyWriter.removeTracks = vi.fn(async () => {
      throw new Error('Spotify said no')
    })
    const records = []
    await expect(
      undoMirror({
        record: ran.at(-1),
        readYoutube: s.readYoutube,
        spotifyWriter: s.spotifyWriter,
        youtubeWriter: s.youtubeWriter,
        onRecord: (next) => records.push(next),
      }),
    ).rejects.toThrow('Removed 1 from YouTube and 0 from Spotify. Then: Spotify said no')
    expect(records.at(-1)).toMatchObject({ addedToYoutube: [], addedToSpotify: ['spotify:track:sE'] })
  })

  test('after a run that failed partway, removes exactly what landed', async () => {
    // Review Focus 5.
    const s = bigScenario({ failYoutubeAddAt: 2 })
    const { records: ran } = await runFailing(s)
    expect(s.state.youtube).toHaveLength(50)
    await undo(s, ran.at(-1))
    expect(s.state.youtube).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/plan/executeMirror.test.js`
Expected: FAIL, because `undoMirror` is not exported.

- [ ] **Step 3: Implement**

In `src/plan/executeMirror.js`, change the undo import to:

```js
import { buildRestoreOrder, startMirrorRecord } from './undo.js'
```

and add after `executeMirror`:

```js
/**
 * Undo the last run (§6): remove what it added, then put YouTube's order
 * back. Each removal leaves the record as soon as its request lands, so a
 * stopped or failed undo can be pressed again and reaches only what is left.
 */
export async function undoMirror({ record, readYoutube, spotifyWriter, youtubeWriter, onRecord, onPhase, signal }) {
  const report = { removedFromYoutube: 0, removedFromSpotify: 0, applied: 0, total: 0 }
  const stopped = () => signal?.aborted === true
  const halt = () => ({ kind: 'undoStopped', ...report })
  let current = record
  const keep = (next) => {
    current = next
    onRecord(next)
  }

  try {
    // 1. YouTube: only what the run recorded adding, so nothing of the
    // owner's is touched (D17).
    onPhase?.('removingYoutube', 0, current.addedToYoutube.length)
    const { found, gone } = resolveAdditions(await readYoutube(), current.addedToYoutube)
    if (gone.length > 0) {
      keep({ ...current, addedToYoutube: current.addedToYoutube.filter((entry) => !gone.includes(entry)) })
    }
    for (const chunk of chunksOf(found, YOUTUBE_CHUNK)) {
      if (stopped()) return halt()
      await youtubeWriter.removeTracks(current.youtubePlaylistId, chunk.map(({ item }) => item))
      const removed = new Set(chunk.map(({ entry }) => entry))
      keep({ ...current, addedToYoutube: current.addedToYoutube.filter((entry) => !removed.has(entry)) })
      report.removedFromYoutube += chunk.length
      onPhase?.('removingYoutube', report.removedFromYoutube, found.length)
    }

    // 2. Spotify.
    // ponytail: Spotify removes every copy of a URI, so a copy the owner added
    // by hand after the run goes too. Exact removal needs Spotify positions.
    const spotifyTotal = current.addedToSpotify.length
    for (const chunk of chunksOf(current.addedToSpotify, SPOTIFY_CHUNK)) {
      if (stopped()) return halt()
      onPhase?.('removingSpotify', report.removedFromSpotify, spotifyTotal)
      await spotifyWriter.removeTracks(current.spotifyPlaylistId, chunk.map((uri) => ({ uri })))
      const removed = new Set(chunk)
      keep({ ...current, addedToSpotify: current.addedToSpotify.filter((uri) => !removed.has(uri)) })
      report.removedFromSpotify += chunk.length
    }
    if (stopped()) return halt()

    // 3. YouTube's order as it was; anything added since goes to the bottom.
    onPhase?.('restoring', 0, 0)
    const youtubeNow = await readYoutube()
    const restored = buildRestoreOrder(youtubeNow, { uris: current.orderBefore }, (track) => track.id)
    const moved = await executeReorder({
      writer: youtubeWriter,
      playlistId: current.youtubePlaylistId,
      currentTracks: youtubeNow,
      targetTracks: restored,
      snapshotId: null,
      keyOf: byItem,
      signal,
      onProgress: (done, total) => {
        report.applied = done
        report.total = total
        onPhase?.('restoring', done, total)
      },
    })
    report.applied = moved.applied
    report.total = moved.ops.length
    if (moved.cancelled) return halt()

    // 4. The record is spent.
    onRecord(null)
    return { kind: 'undone', ...report }
  } catch (cause) {
    throw failure(
      `Removed ${report.removedFromYoutube} from YouTube and ${report.removedFromSpotify} from Spotify.`,
      report,
      cause,
    )
  }
}

/**
 * Each recorded addition, matched to the playlist item it is now (§6): by its
 * setVideoId, or, if YouTube reissued that, by its videoId, one item per
 * addition. An addition that matches neither is already gone.
 */
export function resolveAdditions(tracks, entries) {
  const taken = new Set()
  const found = []
  const take = (track, entry) => {
    taken.add(track)
    found.push({ entry, item: { videoId: track.id, setVideoId: track.itemId } })
  }
  const unresolved = []
  for (const entry of entries) {
    const track = tracks.find((candidate) => candidate.itemId === entry.setVideoId && candidate.id === entry.videoId)
    if (track && !taken.has(track)) take(track, entry)
    else unresolved.push(entry)
  }
  const gone = []
  for (const entry of unresolved) {
    // ponytail: by videoId the first copy is taken. That is a copy the owner
    // added by hand only if YouTube reissued ids and holds such a copy.
    const track = tracks.find((candidate) => candidate.id === entry.videoId && !taken.has(candidate))
    if (track) take(track, entry)
    else gone.push(entry)
  }
  return { found, gone }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/plan/executeMirror.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and lint**

Run: `npm test && npm run lint`
Expected: every test passes; lint reports no errors.

- [ ] **Step 6: Stage**

```bash
git add src/plan/executeMirror.js src/plan/executeMirror.test.js
```

---

### Task 10: App wiring (the URL hold, a quiet re-read, re-pairing)

**Files:**
- Modify: `src/ui/useSorterApp.js`
- Modify: `src/App.jsx`
- Modify: `src/ui/useMatchReview.js`

**Interfaces:**
- Produces, on `app` (the `useSorterApp` return):
  - `mirrorBusy: boolean` and `setMirrorBusy(boolean)`;
  - `refreshPlaylist(): Promise<void>`, which re-reads the open Spotify playlist's row and tracks with no stand-in.
- Produces, on `review` (the `useMatchReview` return):
  - `youtubeTracks: Track[]` and `book: Array`;
  - when `spotifyTracks` changes while a YouTube playlist is chosen, the review reads and pairs that playlist again by itself.
- While `mirrorBusy` is set, App renders the review whatever the URL says, and the URL is put back on the review (as D46 does for Progress).

- [ ] **Step 1: The hold and the quiet re-read in useSorterApp**

In `src/ui/useSorterApp.js`, after `const abort = useRef(null)`, add:

```js
  /** A mirror run is writing from the review (mirror run design §7). */
  const [mirrorBusy, setMirrorBusy] = useState(false)
```

After the `openPlaylist` callback, add:

```js
  /**
   * Re-read the open Spotify playlist where it stands, after the mirror run
   * wrote to it (mirror run design §5). Unlike loadPlaylist it shows no
   * stand-in and clears nothing, so the review stays up while it reads; the
   * fresh snapshot id keeps Sort's own write guard from tripping.
   */
  const refreshPlaylist = useCallback(async () => {
    if (demoRef.current || !playlist || (playlist.source ?? 'spotify') !== 'spotify') return
    const profile = me ?? (await getCurrentUser(client))
    const [row, loaded] = await Promise.all([
      getPlaylist(client, playlist.id, profile.id),
      fetchPlaylistTracks(client, playlist.id),
    ])
    setPlaylist(row)
    setTracks(loaded)
  }, [client, playlist, me])
```

In the effect under "Following the URL", replace:

```js
    if (run) {
      if (route.view !== 'progress' && playlist) {
        navigate({ view: 'progress', source: playlist.source ?? 'spotify', playlistId: playlist.id })
      }
      return
    }
```

with:

```js
    if (run) {
      if (route.view !== 'progress' && playlist) {
        navigate({ view: 'progress', source: playlist.source ?? 'spotify', playlistId: playlist.id })
      }
      return
    }
    // Mirror run §7: while YouTube is being updated the URL stays on the
    // review, as D46 holds Progress, so back cannot leave a run mid-write.
    if (mirrorBusy) {
      if (playlist && (route.view !== 'review' || route.playlistId !== playlist.id)) {
        navigate({ view: 'review', source: 'spotify', playlistId: playlist.id })
      }
      return
    }
```

and change that effect's dependency list to:

```js
  }, [ready, run, mirrorBusy, route, playlist, outcome, navigate, loadPlaylist, resetForSource])
```

In the returned object, add after `undoLast,`:

```js
    mirrorBusy,
    setMirrorBusy,
    refreshPlaylist,
```

- [ ] **Step 2: Keep the review on screen during a run**

In `src/App.jsx`, replace:

```js
  const view = app.run ? 'progress' : route.view
```

with:

```js
  // Mirror run §7, the same hold: the review stays mounted while it writes,
  // so the run keeps its screen and its Stop.
  const view = app.run ? 'progress' : app.mirrorBusy ? 'review' : route.view
```

- [ ] **Step 3: Re-pair after a re-read, and expose what the run needs**

In `src/ui/useMatchReview.js`, after `const sweepTicket = useRef(0)`, add:

```js
  // The playlist last chosen, for pairing again after the Spotify side is re-read.
  const chosenRef = useRef(null)
```

In `choose`, after `const ticket = ++latest.current`, add:

```js
      chosenRef.current = playlistId || null
```

After the `choose` callback, add:

```js
  // Mirror run §5: after a run the app re-reads the Spotify playlist, and the
  // chosen YouTube playlist is read and paired again against both as they now
  // are. A first load, with nothing chosen yet, does nothing.
  const pairedAgainst = useRef(spotifyTracks)
  useEffect(() => {
    if (pairedAgainst.current === spotifyTracks) return
    pairedAgainst.current = spotifyTracks
    // oxlint-disable-next-line react/set-state-in-effect -- the two playlists are the outside systems this follows
    if (chosenRef.current) choose(chosenRef.current)
  }, [spotifyTracks, choose])
```

In the returned object, add after `unavailable,`:

```js
    youtubeTracks,
    book,
```

- [ ] **Step 4: Run the suite and lint**

Run: `npm test && npm run lint`
Expected: every test passes; lint reports no errors.

- [ ] **Step 5: Check the review still loads**

The review lists YouTube playlists as soon as it opens, so it needs the proxy, and the proxy needs `proxy/browser.json` from the YouTube test profile. Without them the review logs a refused or failed request, and the console cannot read 0. If nothing answers at 127.0.0.1:5173, start `npm run dev` in the background. Then:

```
playwright-cli -s=check open "http://127.0.0.1:5173/spotify/demo-1/review?demo=1"
playwright-cli -s=check snapshot
playwright-cli -s=check console error
playwright-cli -s=check close
```

Expected: the review renders its header and the "Match against" field, and the console shows 0 errors. Choose nothing in the field. Stop the server if you started it.

- [ ] **Step 6: Stage**

```bash
git add src/ui/useSorterApp.js src/App.jsx src/ui/useMatchReview.js
```

---

### Task 11: The panel

**Files:**
- Create: `src/ui/useMirrorRun.js`
- Create: `src/ui/screens/MirrorPanel.jsx`
- Modify: `src/ui/screens/Review.jsx`
- Modify: `src/ui/review.css` (appended)

**Interfaces:**
- Consumes:
  - from Task 10: `app.playlist`, `app.tracks`, `app.client`, `app.youtube`, `app.refreshPlaylist`, `app.setMirrorBusy`, and `review.chosenId`, `review.result`, `review.youtubeTracks`, `review.book`, `review.unavailable`;
  - Tasks 5–9.
- Produces:
  - `useMirrorRun({ app, review, storage? })` → `{ preview, reorder, setReorder, phase, running, canRun, outcome, record, keepsData, run, undo, stop }`.
  - `<MirrorPanel mirror unavailable waiting />`.

- [ ] **Step 1: Write the hook**

Create `src/ui/useMirrorRun.js`:

```js
/**
 * The mirror run's panel state (docs/2026-10-11-mirror-run-design.md §7):
 * the preview, the run, Stop and Undo. The run and its undo are
 * src/plan/executeMirror.js; this hook feeds them what the review screen and
 * the app already hold, and keeps the undo record in memory as well as in
 * storage (§6).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { executeMirror, undoMirror } from '../plan/executeMirror.js'
import { estimateMoves, planFill } from '../plan/mirror.js'
import { clearMirrorRecord, loadMirrorRecord, saveMirrorRecord } from '../plan/undo.js'
import { fetchPlaylistTracks } from '../services/spotify/playlists.js'
import { createSpotifyWriter } from '../services/spotify/writer.js'
import { normalizeYouTubeTracks } from '../services/youtube/track.js'
import { createYouTubeWriter } from '../services/youtube/writer.js'

const PROBE_KEY = 'playlist-sorter:probe'

/** Whether this browser keeps site data, asked before a run rather than after. */
function keepsSiteData(storage) {
  try {
    storage.setItem(PROBE_KEY, '1')
    storage.removeItem(PROBE_KEY)
    return true
  } catch {
    return false
  }
}

export function useMirrorRun({ app, review, storage = globalThis.localStorage }) {
  const { playlist, tracks: spotifyTracks, client, youtube, refreshPlaylist, setMirrorBusy } = app
  const { chosenId, result, youtubeTracks, book } = review
  const spotifyId = playlist?.id ?? null
  const editable = playlist?.editable === true
  const [reorder, setReorder] = useState(true)
  const [phase, setPhase] = useState(null)
  const [outcome, setOutcome] = useState(null)
  const [record, setRecord] = useState(null)
  const abort = useRef(null)

  // Each YouTube playlist has its own record (§6), and an outcome belongs to
  // the playlist it happened to.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- storage is the outside system this follows
    setRecord(chosenId ? loadMirrorRecord(chosenId, storage) : null)
    // oxlint-disable-next-line react/set-state-in-effect -- see above
    setOutcome(null)
  }, [chosenId, storage])

  const writers = useMemo(
    () => ({ spotify: createSpotifyWriter(client), youtube: createYouTubeWriter(youtube) }),
    [client, youtube],
  )
  const keepsData = useMemo(() => keepsSiteData(storage), [storage])

  const preview = useMemo(() => {
    if (!result || !chosenId) return null
    const fill = planFill(result)
    const moves = fill.blocked > 0 ? 0 : estimateMoves(spotifyTracks, youtubeTracks, result)
    const adds = fill.addToYoutube.length + fill.addToSpotify.length
    return {
      ...fill,
      moves,
      // Once settled, the only YouTube songs in no pair are the marked ones.
      bottom: result.markedYoutube,
      spotifyLocked: fill.addToSpotify.length > 0 && !editable,
      nothingToDo: fill.blocked === 0 && adds === 0 && (moves === 0 || !reorder),
    }
  }, [result, chosenId, spotifyTracks, youtubeTracks, editable, reorder])

  // Every state of the record is kept in memory, and in storage when the
  // browser allows; null means it is spent (§6).
  const keep = useCallback(
    (next) => {
      setRecord(next)
      if (next) saveMirrorRecord(next, storage)
      else if (chosenId) clearMirrorRecord(chosenId, storage)
    },
    [storage, chosenId],
  )

  const readSpotify = useCallback(() => fetchPlaylistTracks(client, spotifyId), [client, spotifyId])
  const readYoutube = useCallback(
    async () => normalizeYouTubeTracks((await youtube.fetchPlaylist(chosenId)).tracks),
    [youtube, chosenId],
  )
  const onPhase = useCallback((name, done = 0, total = 0) => setPhase({ name, done, total }), [])

  /** The run and its undo alike: hold the screen, then follow both playlists as they now are. */
  const hold = useCallback(
    async (of, work) => {
      const controller = new AbortController()
      abort.current = controller
      setOutcome(null)
      setMirrorBusy(true)
      try {
        setOutcome(await work(controller.signal))
      } catch (failure) {
        setOutcome({ kind: 'failed', of, message: failure.message })
      } finally {
        setPhase(null)
        setMirrorBusy(false)
        // §5: a failed re-read is not the run's failure; the board keeps what it had.
        refreshPlaylist().catch(() => {})
      }
    },
    [setMirrorBusy, refreshPlaylist],
  )

  const canRun =
    preview !== null && preview.blocked === 0 && !preview.spotifyLocked && !preview.nothingToDo && phase === null

  const run = useCallback(() => {
    if (!canRun) return
    setPhase({ name: 'guard', done: 0, total: 0 })
    hold('run', (signal) =>
      executeMirror({
        spotifyPlaylistId: spotifyId,
        youtubePlaylistId: chosenId,
        spotifyEditable: editable,
        readSpotify,
        readYoutube,
        spotifyWriter: writers.spotify,
        youtubeWriter: writers.youtube,
        book,
        previewed: { spotifyTracks, youtubeTracks },
        reorder,
        priorRecord: record,
        onRecord: keep,
        onPhase,
        signal,
      }),
    )
  }, [canRun, hold, spotifyId, chosenId, editable, readSpotify, readYoutube, writers, book, spotifyTracks, youtubeTracks, reorder, record, keep, onPhase])

  const undo = useCallback(() => {
    if (!record || phase !== null) return
    setPhase({ name: 'removingYoutube', done: 0, total: 0 })
    hold('undo', (signal) =>
      undoMirror({
        record,
        readYoutube,
        spotifyWriter: writers.spotify,
        youtubeWriter: writers.youtube,
        onRecord: keep,
        onPhase,
        signal,
      }),
    )
  }, [record, phase, hold, readYoutube, writers, keep, onPhase])

  const stop = useCallback(() => abort.current?.abort(), [])

  return {
    preview,
    reorder,
    setReorder,
    phase,
    running: phase !== null,
    canRun,
    outcome,
    record,
    keepsData,
    run,
    undo,
    stop,
  }
}
```

- [ ] **Step 2: Write the panel**

Create `src/ui/screens/MirrorPanel.jsx`:

```jsx
/**
 * The mirror run's panel (docs/2026-10-11-mirror-run-design.md §7): what an
 * update will change, its progress, and how it ended. Update YouTube itself
 * sits in the review's lever row; Stop and Undo sit here.
 */

import { useState } from 'react'
import { artistsOf, formatCount, titleOf } from '../format.js'
import { Meter, Notice, QuietLever } from '../components/chrome.jsx'

const PHASE_LABEL = {
  guard: 'Checking both playlists',
  addingSpotify: 'Adding to Spotify',
  addingYoutube: 'Adding to YouTube',
  reading: 'Reading both playlists',
  moving: 'Moving',
  verifying: 'Checking the result',
  removingYoutube: 'Removing from YouTube',
  removingSpotify: 'Removing from Spotify',
  restoring: 'Putting YouTube’s order back',
}

const added = (o) => `Added ${formatCount(o.addedToYoutube)} to YouTube and ${formatCount(o.addedToSpotify)} to Spotify.`
const removed = (o) => `Removed ${formatCount(o.removedFromYoutube)} from YouTube and ${formatCount(o.removedFromSpotify)} from Spotify.`
const movedOf = (o) => (o.total > 0 ? ` Moved ${formatCount(o.applied)} of ${formatCount(o.total)}.` : '')

/** @param {{ mirror: object, unavailable: number, waiting: boolean }} props `waiting`: a search sweep is running */
export function MirrorPanel({ mirror, unavailable, waiting }) {
  const { preview, phase, outcome, record, running } = mirror
  const [confirmingUndo, setConfirmingUndo] = useState(false)
  if (!preview) return null

  return (
    <div className="section mirror">
      <p className="col-label" style={{ marginBottom: 8 }}>
        Update YouTube
      </p>

      {running ? (
        <>
          <p className="row-sub" style={{ marginBottom: 8 }}>
            {PHASE_LABEL[phase.name]}
            {phase.total > 0 ? (
              <>
                {' '}
                <span className="num">{formatCount(phase.done)}</span> of <span className="num">{formatCount(phase.total)}</span>
              </>
            ) : null}
          </p>
          <Meter done={phase.done} total={phase.total || 1} />
          <div className="mirror-undo">
            <QuietLever className="lever-quiet is-compact" onClick={mirror.stop}>
              Stop
            </QuietLever>
          </div>
        </>
      ) : (
        <MirrorPlan mirror={mirror} unavailable={unavailable} />
      )}

      {!running && outcome ? <MirrorOutcome outcome={outcome} /> : null}

      {!running && record ? (
        <div className="mirror-undo">
          {confirmingUndo ? (
            <>
              <p className="row-sub">
                Remove {formatCount(record.addedToYoutube.length)} from YouTube and {formatCount(record.addedToSpotify.length)} from
                Spotify, and put YouTube’s order back.
              </p>
              <QuietLever
                className="lever-quiet is-compact"
                onClick={() => {
                  setConfirmingUndo(false)
                  mirror.undo()
                }}
              >
                Undo
              </QuietLever>
              <QuietLever className="lever-quiet is-compact" onClick={() => setConfirmingUndo(false)}>
                Keep it
              </QuietLever>
            </>
          ) : (
            <QuietLever className="lever-quiet is-compact" onClick={() => setConfirmingUndo(true)} disabled={waiting}>
              Undo last update
            </QuietLever>
          )}
        </div>
      ) : null}
    </div>
  )
}

function MirrorPlan({ mirror, unavailable }) {
  const { preview, reorder, setReorder, keepsData } = mirror
  if (preview.blocked > 0) {
    return (
      <p className="row-sub">
        Settle <span className="num">{formatCount(preview.blocked)}</span> more song{preview.blocked === 1 ? '' : 's'} first
      </p>
    )
  }
  if (preview.spotifyLocked) return <p className="row-sub">This Spotify playlist isn’t yours to add to.</p>

  const toYoutube = preview.addToYoutube.length
  const toSpotify = preview.addToSpotify.length
  return (
    <>
      <p className="row-sub">
        {preview.nothingToDo ? (
          'YouTube already matches.'
        ) : (
          <>
            Add <span className="num">{formatCount(toYoutube)}</span> to YouTube · Add{' '}
            <span className="num">{formatCount(toSpotify)}</span> to Spotify ·{' '}
            {reorder ? (
              <>
                about <span className="num">{formatCount(preview.moves)}</span> moves
              </>
            ) : (
              'Order left as it is'
            )}
          </>
        )}
      </p>
      <label className="mirror-toggle">
        <input type="checkbox" checked={reorder} onChange={(event) => setReorder(event.target.checked)} />
        Also reorder YouTube to Spotify’s order
      </label>
      {toYoutube + toSpotify > 0 ? (
        <details className="mirror-list">
          <summary className="col-label">
            Songs to add (<span className="num">{formatCount(toYoutube + toSpotify)}</span>)
          </summary>
          {preview.addToYoutube.map((track) => (
            <MirrorRow key={`y${track.id}`} track={track} where="To YouTube" />
          ))}
          {preview.addToSpotify.map((track) => (
            <MirrorRow key={`s${track.id}`} track={track} where="To Spotify" />
          ))}
        </details>
      ) : null}
      {preview.bottom.length > 0 ? (
        <details className="mirror-list">
          <summary className="col-label">
            Going to the bottom (<span className="num">{formatCount(preview.bottom.length)}</span>)
          </summary>
          {preview.bottom.map((track) => (
            <MirrorRow key={`b${track.itemId}`} track={track} where="Not on Spotify" />
          ))}
        </details>
      ) : null}
      {unavailable > 0 ? (
        <p className="row-sub">
          <span className="num">{formatCount(unavailable)}</span> item{unavailable === 1 ? '' : 's'} YouTube won’t show us{' '}
          {unavailable === 1 ? 'stays' : 'stay'} where {unavailable === 1 ? 'it is' : 'they are'}.
        </p>
      ) : null}
      {keepsData ? null : (
        <Notice tone="amber" title="Undo will not be remembered">
          Undo will last only until you leave this screen: this browser isn’t keeping site data.
        </Notice>
      )}
    </>
  )
}

function MirrorRow({ track, where }) {
  return (
    <div className="mirror-row">
      <span className="mirror-song">
        {titleOf(track)} · {artistsOf(track)}
      </span>
      <span className="row-sub">{where}</span>
    </div>
  )
}

function MirrorOutcome({ outcome }) {
  if (outcome.kind === 'stale') {
    return (
      <Notice tone="amber" title="Nothing was written">
        A playlist changed since the preview. It has been re-read: check the new preview.
      </Notice>
    )
  }
  if (outcome.kind === 'failed') {
    return (
      <Notice tone="red" title={outcome.of === 'undo' ? 'Undo stopped' : 'The update stopped'}>
        {outcome.message}
      </Notice>
    )
  }
  if (outcome.kind === 'stopped') {
    return (
      <Notice tone="amber" title="Stopped">
        {added(outcome)}
        {movedOf(outcome)} Run it again to finish, or Undo.
      </Notice>
    )
  }
  if (outcome.kind === 'undoStopped') {
    return (
      <Notice tone="amber" title="Undo stopped">
        {removed(outcome)}
        {movedOf(outcome)} Undo again to finish.
      </Notice>
    )
  }
  if (outcome.kind === 'undone') {
    return (
      <Notice tone="green" title="Put back">
        {removed(outcome)} YouTube’s order is back.
      </Notice>
    )
  }
  return (
    <>
      {outcome.matches === false ? (
        <Notice tone="amber" title="YouTube shows a different order">
          YouTube shows a different order than the one written. If this playlist is set to sort by date in YouTube Music,
          set it to Manual and run again.
        </Notice>
      ) : (
        <Notice tone="green" title="YouTube updated">
          {added(outcome)}
          {outcome.total > 0 ? ` Moved ${formatCount(outcome.applied)}.` : ''}
        </Notice>
      )}
      {outcome.unpaired.length > 0 ? (
        <Notice tone="amber" title="Added, but not paired">
          {outcome.unpaired.map(titleOf).join(', ')}: the service added a different track than the one asked for, so it
          did not pair. It is at the bottom with the songs only on YouTube.
        </Notice>
      ) : null}
    </>
  )
}
```

- [ ] **Step 3: Style it**

Append to `src/ui/review.css`:

```css
/* ---- The mirror run's panel (mirror run design §7) -------------------- */

.mirror-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.mirror-list {
  margin-top: 10px;
}

.mirror-list > summary {
  cursor: pointer;
}

/* Two cells, so the layout check measures them: the song, and where it goes. */
.mirror-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--rule-soft);
}

.mirror-song {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mirror-undo {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin-top: 10px;
}
```

- [ ] **Step 4: Put it on the review screen**

In `src/ui/screens/Review.jsx`:

Replace the first line of the header comment's second paragraph:

```js
 * Read-only. Decisions go to the match book; nothing is written to Spotify or
 * YouTube. Likely rows warm amber (pending) and settled rows take the green
```

with:

```js
 * Decisions go to the match book. The one write is Update YouTube, made
 * through its panel (docs/2026-10-11-mirror-run-design.md). Likely rows warm
 * amber (pending) and settled rows take the green
```

Add to the imports:

```js
import { useMirrorRun } from '../useMirrorRun.js'
import { MirrorPanel } from './MirrorPanel.jsx'
```

Replace:

```js
  const review = useMatchReview({ youtube, spotify: client, spotifyTracks: tracks })
  const { result, sweep } = review
```

with:

```js
  const review = useMatchReview({ youtube, spotify: client, spotifyTracks: tracks })
  const mirror = useMirrorRun({ app, review })
  const { result, sweep } = review
```

Replace:

```js
  const deciding = sweep?.running === true
```

with:

```js
  // Mirror run §7: a run waits the same way, and holds every lever until it ends.
  const deciding = sweep?.running === true || mirror.running
```

Replace:

```js
        back={{ label: 'Back to sorting', onClick: () => setScreen('sort') }}
```

with:

```js
        back={mirror.running ? undefined : { label: 'Back to sorting', onClick: () => setScreen('sort') }}
```

Replace:

```js
          disabled={tracks.length === 0}
```

with:

```js
          disabled={tracks.length === 0 || mirror.running}
```

Replace the opening of the board block:

```js
      {result ? (
        <div className="board board-review">
```

with:

```js
      {result ? <MirrorPanel mirror={mirror} unavailable={review.unavailable} waiting={sweep?.running === true} /> : null}

      {result ? (
        <div className="board board-review">
```

Replace the lever row:

```js
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
```

with:

```js
        <QuietLever
          onClick={review.searchAll}
          disabled={!result || sweep?.running === true || mirror.running || review.unsearchedCount === 0}
        >
          Search all unmatched
        </QuietLever>
        <span className="spacer" />
        <Lever disabled={strong.length === 0 || deciding} onClick={() => review.confirmAll(strong)}>
          Confirm all <span className="num">{formatCount(strong.length)}</span> strong
        </Lever>
        <Lever disabled={!mirror.canRun || deciding} onClick={mirror.run}>
          Update YouTube
        </Lever>
```

- [ ] **Step 5: Run the suite and lint**

Run: `npm test && npm run lint`
Expected: every test passes; lint reports no errors.

- [ ] **Step 6: Check the blocked state in the browser**

Demo mode with the real proxy: the demo Spotify songs pair with nothing, so the panel must say how many are left. This only reads YouTube. With `npm run dev` running (it starts the proxy, which must hold the YouTube test profile's `browser.json`):

```
playwright-cli -s=check open "http://127.0.0.1:5173/spotify/demo-1/review?demo=1"
playwright-cli -s=check snapshot
```

Choose **"test punjabi songs"** in "Match against" (use `select` with the ref from the snapshot). No other playlist may be opened (CLAUDE.md). Then:

```
playwright-cli -s=check snapshot
playwright-cli -s=check console error
playwright-cli -s=check close
```

Expected: an "Update YouTube" section reading "Settle N more songs first", an **Update YouTube** lever that is disabled, and 0 console errors. Nothing is written: the lever cannot be pressed. Stop the server if you started it.

- [ ] **Step 7: Stage**

```bash
git add src/ui/useMirrorRun.js src/ui/screens/MirrorPanel.jsx src/ui/screens/Review.jsx src/ui/review.css
```

---

### Task 12: The layout check covers a Ready panel

**Files:**
- Modify: `scripts/check-columns.js`

**Interfaces:**
- Consumes: Task 11's `.mirror`, `.mirror-list` and `.mirror-row` classes, and the **Update YouTube** lever.
- Produces: a `review-ready` pass at all six widths. The script throws if the panel is not Ready, and must still report `{}`.

- [ ] **Step 1: Measure the panel's rows**

In `scripts/check-columns.js`, in `measure`, replace:

```js
      '.board-row, .board-cols, .lever-row, .head, .tally, .peek-row, .tray-cand, .tray-field, .tray-pair .tray-actions, .tray-head, .tray-foot',
```

with:

```js
      '.board-row, .board-cols, .lever-row, .head, .tally, .peek-row, .tray-cand, .tray-field, .tray-pair .tray-actions, .tray-head, .tray-foot, .mirror-row',
```

- [ ] **Step 2: Build the two match books once**

After the `spotifyLong` definition, add:

```js
  // Every Spotify song's match-book key: its id, or a local file's URI.
  const spotifyKeys = await page.evaluate(async () => {
    const module = await import('/src/ui/demoData.js')
    return module.loadDemo().tracks.map((track) => track.id ?? track.uri).filter(Boolean)
  })
  // The review pass: one settled pair, and one song marked on each side.
  const reviewBook = [
    { spotifyKey: demo[0].id, youtubeVideoId: 'strong00000', verdict: 'same', decidedAt: 1 },
    { spotifyKey: demo[12].id, youtubeVideoId: null, verdict: 'none', decidedAt: 1 },
    { spotifyKey: null, youtubeVideoId: 'longvid5000', verdict: 'none', decidedAt: 1 },
  ]
  // The review-ready pass (mirror run design §7): every row settled, so the
  // panel is Ready. The six twins are confirmed, one long-titled find is to
  // be added on each side, and every other song is marked.
  const longFind = (side, uri) => ({
    side,
    name: LONG,
    artists: LONG_ARTISTS,
    durationMs: 241000,
    videoType: side === 'youtube' ? 'MUSIC_VIDEO_TYPE_OMV' : null,
    uri,
  })
  const twins = [
    ...demo.slice(0, 4).map((track, index) => [track.id, `strong${index}0000`.slice(0, 11)]),
    ...demo.slice(4, 6).map((track, index) => [track.id, `likely${index}0000`.slice(0, 11)]),
  ]
  const settledKeys = new Set([...twins.map(([key]) => key), demo[6].id])
  const readyBook = [
    ...twins.map(([spotifyKey, youtubeVideoId]) => ({ spotifyKey, youtubeVideoId, verdict: 'same', decidedAt: 1 })),
    { spotifyKey: demo[6].id, youtubeVideoId: 'findyt00000', verdict: 'same', decidedAt: 1, found: longFind('youtube', null) },
    {
      spotifyKey: 'findsp00000000000000000',
      youtubeVideoId: 'longvid5000',
      verdict: 'same',
      decidedAt: 1,
      found: longFind('spotify', 'spotify:track:findsp00000000000000000'),
    },
    ...['longvid0000', 'longvid1000', 'longvid2000', 'longvid3000', 'longvid4000'].map((youtubeVideoId) => ({
      spotifyKey: null,
      youtubeVideoId,
      verdict: 'none',
      decidedAt: 1,
    })),
    ...spotifyKeys
      .filter((key) => !settledKeys.has(key))
      .map((spotifyKey) => ({ spotifyKey, youtubeVideoId: null, verdict: 'none', decidedAt: 1 })),
  ]
```

- [ ] **Step 3: Add the pass**

Add the screen to the `screens` list, after the `review` entry:

```js
    ['review-ready', '/spotify/demo-1/review?demo=1'],
```

In the loop, replace the whole seeding call:

```js
      // One settled pair, so the Settled group has a row to measure, and one
      // song marked on each side (a long YouTube title among them), so the
      // "Not on the other service" group does too.
      await page.evaluate(
        ([key, markedKey]) =>
          localStorage.setItem(
            'playlist-sorter:match-book',
            JSON.stringify([
              { spotifyKey: key, youtubeVideoId: 'strong00000', verdict: 'same', decidedAt: 1 },
              { spotifyKey: markedKey, youtubeVideoId: null, verdict: 'none', decidedAt: 1 },
              { spotifyKey: null, youtubeVideoId: 'longvid5000', verdict: 'none', decidedAt: 1 },
            ]),
          ),
        [demo[0].id, demo[12].id],
      )
```

with:

```js
      // The review pass gets one settled pair and one song marked on each
      // side, so the Settled and "Not on the other service" groups have rows
      // to measure. The review-ready pass gets every row settled.
      await page.evaluate(
        (book) => localStorage.setItem('playlist-sorter:match-book', JSON.stringify(book)),
        name === 'review-ready' ? readyBook : reviewBook,
      )
```

and replace:

```js
      if (name !== 'review') {
        note(`${name}@${width}`, await page.evaluate(measure))
        continue
      }
```

with:

```js
      if (name === 'review-ready') {
        await page.selectOption('#review-youtube', 'PLT')
        await page.waitForSelector('.mirror')
        if (await page.getByRole('button', { name: 'Update YouTube' }).isDisabled()) {
          throw new Error(`review-ready@${width}: the mirror panel is not Ready`)
        }
        for (const summary of await page.locator('.mirror-list > summary').all()) await summary.click()
        if ((await page.locator('.mirror-row').count()) < 2) throw new Error(`review-ready@${width}: no rows to measure`)
        note(`review-ready@${width}`, await page.evaluate(measure))
        continue
      }
      if (name !== 'review') {
        note(`${name}@${width}`, await page.evaluate(measure))
        continue
      }
```

- [ ] **Step 4: Run it**

With the dev server running (`npm run dev:web` is enough: the script mocks the proxy):

```
playwright-cli -s=columns open about:blank
playwright-cli -s=columns --raw run-code --filename=scripts/check-columns.js
playwright-cli -s=columns close
```

Expected: `{}`. If it throws "not Ready", take a snapshot at that width and read the panel's line. "Settle N more songs first" means a demo song is unsettled: find which and add it to the book. Do not loosen the check. If it reports overflow, fix the CSS in `review.css`, not the check.

- [ ] **Step 5: Stage**

```bash
git add scripts/check-columns.js
```

---

### Task 13: Live walkthrough, and the record (needs the owner's OK)

> **Amended 2026-10-12 (owner's decision; see CLAUDE.md, "Live checks"):** live checks run in the owner's
> Chrome through the Claude in Chrome connector, not in `playwright-cli -s=live`. Each script's
> `page.evaluate` body runs in a connector tab at `http://127.0.0.1:5173`, and the owner's match book
> comes from `.local/real-library/match-book.json`. The steps below otherwise stand.

**Files:**
- Create (never staged): `.playwright-cli/read-test-playlists.js`
- Modify: `docs/STATUS.md`, `docs/2026-10-11-mirror-run-design.md` (status line)

- [ ] **Step 1: Ask the owner**

First open the review to read the counts. Then send the owner this, with the numbers filled in, and wait for a yes:

> The walkthrough writes to "test punjabi songs" on the test profiles only. Update YouTube will add <N> songs to the YouTube playlist and <M> to the Spotify one, and reorder the YouTube one (about <K> moves). Then Undo removes all of them and puts the order back. After that I run it once more, stop it during the reorder, run it again to finish, and Undo again. Before and after, I read both playlists and confirm they end exactly as they started. OK?

- [ ] **Step 2: Write a read-only check of both playlists**

Create `.playwright-cli/read-test-playlists.js`:

```js
// Reads "test punjabi songs" on both services and changes nothing: the
// before/after check for the mirror run walkthrough.
//   playwright-cli -s=live --raw run-code --filename=.playwright-cli/read-test-playlists.js
async (page) => {
  const NAME = 'test punjabi songs'
  await page.goto('http://127.0.0.1:5173/')
  // Let the app finish resuming its Spotify session before refreshing the token here.
  await page.waitForFunction((name) => document.body.textContent.includes(name), NAME, { timeout: 30000 })
  const out = await page.evaluate(async (NAME) => {
    const proxy = async (path) => (await fetch(`http://127.0.0.1:8787${path}`)).json()
    const [yt] = (await proxy('/playlists')).playlists.filter((p) => p.title === NAME)
    const youtube = (await proxy(`/playlists/${yt.id}`)).tracks.map((t) => t.videoId)

    const { refreshTokens } = await import('/src/services/spotify/spotifyAuth.js')
    const tokens = await refreshTokens({
      clientId: localStorage.getItem('playlist-sorter:client-id'),
      refreshToken: localStorage.getItem('playlist-sorter:refresh-token'),
    })
    localStorage.setItem('playlist-sorter:refresh-token', tokens.refreshToken)
    const get = async (url) =>
      (await fetch(url.startsWith('https://') ? url : `https://api.spotify.com/v1${url}`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      })).json()
    const every = async (url) => {
      const items = []
      for (let next = url; next; ) {
        const page = await get(next)
        items.push(...(page?.items ?? []))
        next = page?.next ?? null
      }
      return items
    }
    const [sp] = (await every('/me/playlists?limit=50')).filter((p) => p?.name === NAME)
    const spotify = (await every(`/playlists/${sp.id}/items?limit=100&fields=next,items(item(uri),track(uri))`)).map(
      (i) => (i.item ?? i.track)?.uri ?? null,
    )
    return { youtube, spotify }
  }, NAME)
  await page.reload()
  return JSON.stringify(out)
}
```

- [ ] **Step 3: Read the starting state**

Run `npm run dev` if nothing answers (YouTube needs the proxy). Open the live session (Task 3, Step 2). Then run:

`playwright-cli -s=live --raw run-code --filename=.playwright-cli/read-test-playlists.js > .playwright-cli/before.json`

- [ ] **Step 4: Run, check, undo**

In the live session:
1. Open the Spotify "test punjabi songs" → **Match to YouTube** → choose "test punjabi songs".
2. **Check the panel against the board.** "Add N to YouTube" equals the number of Settled rows marked "Not in your YouTube playlist", and "Add M to Spotify" the number marked "Not in your Spotify playlist".
3. Press **Update YouTube**. While it runs, press the browser's back button once: the screen must stay on the review, and the URL must return to `/spotify/<id>/review`.
4. When it ends: a green "YouTube updated" line, and `console error` shows 0. Take a screenshot.
5. The board reloads, and no Settled row says "Not in your … playlist".
6. **Undo last update** → read the confirm line → **Undo**. Expect a green "Put back".
7. Run the read script into `.playwright-cli/after-undo.json` and compare: `diff .playwright-cli/before.json .playwright-cli/after-undo.json` prints nothing.

If any write fails, or Undo is not offered or fails: **stop**. Run the read script, and tell the owner exactly what each playlist holds compared with `before.json`.

- [ ] **Step 5: Stop, run again, undo (D54)**

1. **Update YouTube**; during "Moving", press **Stop**. Expect an amber "Stopped" line.
2. **Update YouTube** again. The preview shows nothing left to add, and it finishes green.
3. **Undo last update** → **Undo**.
4. Run the read script into `.playwright-cli/after-rerun.json`; `diff .playwright-cli/before.json .playwright-cli/after-rerun.json` must print nothing.

- [ ] **Step 6: Layout check, and clean up**

Run the layout check (Task 12, Step 4); it must report `{}`. Close every session you opened, and stop any server you started.

- [ ] **Step 7: Record it**

In `docs/2026-10-11-mirror-run-design.md`, change `**Status:** Draft for review` to `**Status:** Built <date>`.

In `docs/STATUS.md`:
- under "Carried into the next session", replace the bullet that begins "**Security, before write endpoints land (2c):**" with:

  ```markdown
  - **Security, settled (D48):** the proxy refuses a request addressed to any
    host but `127.0.0.1` or `localhost`, and a write from any origin but the
    app's. See the mirror run design.
  ```

- add a section before "## Open: features not built":

  ```markdown
  ## Mirror run — done <date>

  **Update YouTube** on the review adds every settled find to the playlist
  missing it, appends Spotify's additions to its end, and reorders the YouTube
  playlist into Spotify's order, songs only on YouTube at the bottom. Undo
  removes exactly what the run added and puts YouTube's order back. Spec:
  [2026-10-11-mirror-run-design.md](2026-10-11-mirror-run-design.md).

  - The proxy writes for the first time, guarded by Host and Origin checks (D48).
  - A run needs every row settled (D50). Running again resumes a stopped run (D55).
  - Checked live on "test punjabi songs": <N> added to YouTube, <M> to Spotify,
    <K> moves, the final check green. Undo returned both playlists exactly to
    their starting state, and so did stop, run again, Undo.
  - Left open: how YouTube treats a playlist set to sort by date is not yet
    seen; the run's final check would report it (D53).
  ```

- [ ] **Step 8: Run everything once more, and stage**

Run: `npm test && npm run lint`, then, from `proxy/`, `python -m pytest`.
Expected: all pass.

```bash
git add docs/STATUS.md docs/2026-10-11-mirror-run-design.md
```

Then tell the owner the branch is ready to commit, and list what is staged (`git diff --cached --stat`).
