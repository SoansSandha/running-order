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
