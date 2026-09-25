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
