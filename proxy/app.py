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

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware
from ytmusicapi import YTMusic
from ytmusicapi.exceptions import YTMusicServerError, YTMusicUserError

VITE_ORIGIN = "http://127.0.0.1:5173"
WRITE_METHODS = {"POST", "PATCH", "DELETE"}

# The proxy serves the app and nothing else, so it serves no API docs pages.
app = FastAPI(title="Running Order — YouTube proxy", docs_url=None, redoc_url=None, openapi_url=None)


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
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["*"],
)
# D48: DNS rebinding reaches this port under another name, as if it were that
# page's own origin, so CORS never applies. Added last, so it runs first.
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])

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


def reset_client() -> None:
    """Drop the cached client so refreshed credentials are picked up."""
    global _client
    _client = None


@app.get("/auth/status")
def auth_status() -> dict:
    """Whether stored credentials load. Never returns the credentials.

    This proves only that the credential file parses — for browser auth,
    construction makes no network call, so a session YouTube killed
    server-side loads exactly as well as a live one. See the POST route for
    the check that actually detects a dead session.
    """
    try:
        get_client()
        return {"authenticated": True}
    except Exception:
        return {"authenticated": False}


def session_alive() -> bool:
    """One authenticated call, to tell a live session from a dead one.

    A failure drops the cached client, so credentials refreshed on disk are
    read on the next call instead of the dead session being reused forever.
    """
    try:
        get_client().get_playlist("LM", limit=1)
        return True
    except Exception:
        reset_client()
        return False


@app.post("/auth/status")
def auth_status_live() -> dict:
    """Whether the stored session still authenticates server-side (spec §5).

    GET only proves a credential file parses. Browser auth makes no network
    call at construction, so a session YouTube killed loads exactly as well
    as a live one. This makes one authenticated call to find out.
    """
    return {"authenticated": session_alive()}


@app.get("/playlists")
def list_playlists() -> dict:
    """The user's library playlists, renamed to the app's field names.

    An EXPIRED session does not fail here: YouTube answers the library read
    with an empty list and a 200, and the app would tell the user they have no
    playlists. So an empty library is checked against the live probe, and
    reported as 401 when the session is dead. The inference is sound because
    YouTube just answered — the network is fine, so a failing authenticated
    call is the session.
    """
    try:
        raw = get_client().get_library_playlists(limit=None)
    except Exception:
        reset_client()
        raise HTTPException(status_code=502, detail="Could not reach YouTube Music.")
    if not raw and not session_alive():
        raise HTTPException(status_code=401, detail="YouTube Music session expired.")
    return {
        "playlists": [
            {
                "id": p.get("playlistId"),
                "title": p.get("title"),
                "count": p.get("count"),
                "description": p.get("description"),
                "thumbnails": p.get("thumbnails") or [],
            }
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
    try:
        raw = get_client().get_playlist(playlist_id, limit=None)
    except Exception:
        reset_client()
        # Never interpolate the exception's own string: for a malformed
        # credentials file, a json.JSONDecodeError's `.doc` carries the whole
        # document, which is proxy/browser.json — session cookies.
        raise HTTPException(status_code=502, detail="Could not reach YouTube Music.")
    tracks = raw.get("tracks") or []
    return {
        "id": raw.get("id"),
        "title": raw.get("title"),
        "counted": raw.get("trackCount"),
        "readable": len(tracks),
        "tracks": tracks,
    }


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


class AddItems(BaseModel):
    videoIds: list[str] = Field(min_length=1)


class MoveItem(BaseModel):
    setVideoId: str
    beforeSetVideoId: str | None = None


class PlaylistItem(BaseModel):
    videoId: str
    setVideoId: str


class RemoveItems(BaseModel):
    items: list[PlaylistItem] = Field(min_length=1)


MALFORMED = "YouTube Music refused the request as malformed."


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
    except YTMusicUserError:
        # Malformed input, not a dead session: the client is kept (no re-auth).
        raise HTTPException(status_code=400, detail=MALFORMED)
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
    through (mirror design §4). A move with no successor goes to the end, as
    the probe measured (mirror run design §9).
    """
    move = (body.setVideoId, body.beforeSetVideoId) if body.beforeSetVideoId else body.setVideoId
    try:
        response = get_client().edit_playlist(playlist_id, moveItem=move)
    except YTMusicUserError:
        raise HTTPException(status_code=400, detail=MALFORMED)
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
    except YTMusicUserError:
        raise HTTPException(status_code=400, detail=MALFORMED)
    except Exception:
        reset_client()
        raise HTTPException(status_code=502, detail="Could not reach YouTube Music.")
    if not succeeded(response):
        raise HTTPException(status_code=409, detail="YouTube Music refused the removal.")
    return {"ok": True}
