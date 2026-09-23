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
