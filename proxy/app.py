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

from fastapi import FastAPI, HTTPException
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
