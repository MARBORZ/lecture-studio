"""The API answers only this computer: Host must be loopback (DNS rebinding), writes from other sites' pages get 403."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(data_dir):
    from backend.main import app

    with TestClient(app, base_url="http://127.0.0.1") as c:
        yield c


@pytest.mark.parametrize("host", ["127.0.0.1", "127.0.0.1:3000", "localhost:3001", "[::1]:3000", "localhost"])
def test_local_hosts_pass(client, host):
    assert client.get("/api/health", headers={"Host": host}).status_code == 200


@pytest.mark.parametrize("host", ["evil.com", "evil.com:3000", "127.0.0.1.evil.com", "192.168.1.5:3000"])
def test_other_hosts_get_400(client, host):
    assert client.get("/api/health", headers={"Host": host}).status_code == 400


@pytest.mark.parametrize("origin", ["https://evil.com", "http://127.0.0.1.evil.com:5173", "null"])
def test_writes_from_other_sites_get_403(client, origin, monkeypatch):
    from backend.api.routes import system

    stopped = []
    monkeypatch.setattr(system, "_stop_everything", lambda: stopped.append(1))  # safety net if the guard ever lets it through
    r = client.post("/api/system/shutdown", headers={"Origin": origin})
    assert r.status_code == 403
    assert client.patch("/api/settings", headers={"Origin": origin}, json={"theme": "dark"}).status_code == 403
    assert client.get("/api/settings").json()["theme"] != "dark"
    assert stopped == []


@pytest.mark.parametrize("origin", ["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:5174", None])
def test_writes_from_the_app_pass(client, origin):
    headers = {"Origin": origin} if origin else {}  # no Origin: launchers, curl, not a browser page
    assert client.patch("/api/settings", headers=headers, json={"theme": "dark"}).status_code == 200


def test_reads_with_foreign_origin_are_left_to_cors(client):
    r = client.get("/api/health", headers={"Origin": "https://evil.com"})
    assert r.status_code == 200
    assert "access-control-allow-origin" not in r.headers  # the browser hides the answer from that page
