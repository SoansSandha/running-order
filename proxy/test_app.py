"""The proxy is thin by construction, so these tests cover auth and shape only."""
import pytest
from fastapi.testclient import TestClient

import app as proxy
from ytmusicapi.exceptions import YTMusicServerError, YTMusicUserError


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
        {"id": "PL1", "title": "punjabi songs", "count": 382, "description": None, "thumbnails": []},
        {"id": "LM", "title": "Liked Music", "count": None, "description": None, "thumbnails": []},
    ]}


def test_playlist_thumbnails_pass_through_unchanged(client, monkeypatch):
    # D13: the proxy reshapes nothing, and does not pick a thumbnail —
    # choosing one is a decision, and decisions live in JS.
    thumbnails = [
        {"url": "https://example.com/small.jpg", "width": 60, "height": 60},
        {"url": "https://example.com/large.jpg", "width": 226, "height": 226},
    ]
    fake = FakeYT(playlists=[
        {
            "playlistId": "PL1",
            "title": "punjabi songs",
            "count": 382,
            "description": "road trip",
            "thumbnails": thumbnails,
        },
    ])
    monkeypatch.setattr(proxy, "get_client", lambda: fake)
    body = client.get("/playlists").json()
    assert body["playlists"] == [
        {
            "id": "PL1",
            "title": "punjabi songs",
            "count": 382,
            "description": "road trip",
            "thumbnails": thumbnails,
        },
    ]


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


class RaisingYT:
    """A client whose calls always fail, as a dead session or a bad id would."""

    def __init__(self, message="session dead — leaky detail, must never reach a response"):
        self._message = message

    def get_playlist(self, playlistId, limit=None):
        raise RuntimeError(self._message)

    def get_library_playlists(self, limit=None):
        raise RuntimeError(self._message)

    def search(self, query, filter=None, limit=20):
        raise RuntimeError(self._message)

    def get_watch_playlist(self, videoId=None, limit=25):
        raise RuntimeError(self._message)

    def add_playlist_items(self, playlistId, videoIds=None, source_playlist=None, duplicates=False):
        raise RuntimeError(self._message)

    def edit_playlist(self, playlistId, moveItem=None):
        raise RuntimeError(self._message)

    def remove_playlist_items(self, playlistId, videos):
        raise RuntimeError(self._message)


def test_post_auth_status_true_when_the_probe_succeeds(client, monkeypatch):
    fake = FakeYT(playlist={"id": "LM", "tracks": []})
    monkeypatch.setattr(proxy, "get_client", lambda: fake)
    assert client.post("/auth/status").json() == {"authenticated": True}
    assert fake.get_playlist_calls == [{"playlistId": "LM", "limit": 1}]


def test_post_auth_status_false_when_the_probe_raises(client, monkeypatch):
    monkeypatch.setattr(proxy, "get_client", lambda: RaisingYT())
    assert client.post("/auth/status").json() == {"authenticated": False}


def test_post_auth_status_failure_resets_the_cached_client(client, monkeypatch):
    # Set the cache directly, rather than mocking get_client, so this proves
    # reset_client() actually clears proxy._client and not just a mock's return.
    monkeypatch.setattr(proxy, "_client", RaisingYT())
    client.post("/auth/status")
    assert proxy._client is None


def test_playlists_route_failure_becomes_a_clean_http_error(client, monkeypatch):
    monkeypatch.setattr(proxy, "get_client", lambda: RaisingYT("top secret cookie"))
    response = client.get("/playlists")
    assert response.status_code == 502
    assert "top secret cookie" not in response.text


def test_playlist_route_failure_becomes_a_clean_http_error(client, monkeypatch):
    monkeypatch.setattr(proxy, "get_client", lambda: RaisingYT("top secret cookie"))
    response = client.get("/playlists/PL1")
    assert response.status_code == 502
    assert "top secret cookie" not in response.text


class DeadSessionYT:
    """What an expired browser session measurably does: the library read
    succeeds and comes back empty, and an authenticated read raises."""

    def __init__(self, message="session dead — leaky detail, must never reach a response"):
        self._message = message

    def get_library_playlists(self, limit=None):
        return []

    def get_playlist(self, playlistId, limit=None):
        raise RuntimeError(self._message)


def test_an_empty_library_on_a_dead_session_is_reported_as_expired(client, monkeypatch):
    # YouTube answers an expired session with an empty library and a 200, so
    # without a probe the app tells the user they have no playlists.
    monkeypatch.setattr(proxy, "get_client", lambda: DeadSessionYT("top secret cookie"))
    response = client.get("/playlists")
    assert response.status_code == 401
    assert "expired" in response.json()["detail"]
    assert "top secret cookie" not in response.text


def test_an_empty_library_on_a_live_session_is_still_just_empty(client, monkeypatch):
    fake = FakeYT(playlists=[], playlist={"id": "LM", "tracks": []})
    monkeypatch.setattr(proxy, "get_client", lambda: fake)
    response = client.get("/playlists")
    assert response.status_code == 200
    assert response.json() == {"playlists": []}


def test_an_expired_session_drops_the_cached_client(client, monkeypatch):
    # Set the cache directly, so this proves the route clears proxy._client.
    # Without it, fresh credentials copied into place are never read.
    monkeypatch.setattr(proxy, "_client", DeadSessionYT())
    client.get("/playlists")
    assert proxy._client is None


@pytest.mark.parametrize("path", ["/playlists", "/playlists/PL1"])
def test_a_failing_route_drops_the_cached_client(client, monkeypatch, path):
    monkeypatch.setattr(proxy, "_client", RaisingYT())
    assert client.get(path).status_code == 502
    assert proxy._client is None


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


def test_an_empty_add_is_refused_before_it_reaches_youtube(client, monkeypatch):
    # ytmusicapi raises YTMusicUserError for an empty list, before any network call.
    fake = WriteYT(add_response=ADDED)
    monkeypatch.setattr(proxy, "get_client", lambda: fake)
    assert client.post("/playlists/PL1/items", json={"videoIds": []}).status_code == 422
    assert fake.calls == []


def test_an_empty_remove_is_refused_before_it_reaches_youtube(client, monkeypatch):
    fake = WriteYT()
    monkeypatch.setattr(proxy, "get_client", lambda: fake)
    assert client.request("DELETE", "/playlists/PL1/items", json={"items": []}).status_code == 422
    assert fake.calls == []


class MalformedYT:
    """A client whose calls fail the way ytmusicapi fails on a bad argument."""

    def add_playlist_items(self, playlistId, videoIds=None, source_playlist=None, duplicates=False):
        raise YTMusicUserError("leaky detail")

    def edit_playlist(self, playlistId, moveItem=None):
        raise YTMusicUserError("leaky detail")

    def remove_playlist_items(self, playlistId, videos):
        raise YTMusicUserError("leaky detail")


@pytest.mark.parametrize("method,path,body", WRITES)
def test_a_malformed_write_is_a_400_and_keeps_the_client(client, monkeypatch, method, path, body):
    # A client-side input error is not a dead session: no 502, and no re-auth.
    fake = MalformedYT()
    monkeypatch.setattr(proxy, "_client", fake)
    response = client.request(method, path, json=body)
    assert response.status_code == 400
    assert "leaky detail" not in response.text
    assert proxy._client is fake


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_no_api_docs_are_served(client, path):
    assert client.get(path).status_code == 404
