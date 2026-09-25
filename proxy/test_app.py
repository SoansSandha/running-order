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
