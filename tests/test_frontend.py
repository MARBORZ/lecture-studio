"""The built UI served by the API server (api/frontend.py) and the two-port server (serve.py)."""

import socket

import pytest
from fastapi.testclient import TestClient

from backend import config

INDEX = "<!doctype html><div id=root></div>"


@pytest.fixture()
def dist(tmp_path, monkeypatch):
    root = tmp_path / "dist"
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_text(INDEX)
    (root / "assets" / "index-abc123.js").write_text("console.log(1)")
    (root / "assets" / "index-abc123.css").write_text("body{}")
    (root / "favicon.svg").write_text("<svg/>")
    (tmp_path / "secret.txt").write_text("outside dist")
    monkeypatch.setattr(config, "FRONTEND_DIST", root)
    return root


@pytest.fixture()
def client(data_dir, dist):
    from backend.main import app

    with TestClient(app, base_url="http://127.0.0.1:5173") as c:
        yield c


@pytest.mark.parametrize("path", ["/", "/settings/interface", "/project/proj_inbox/lesson/les_1", "/diary"])
def test_app_routes_get_index_without_cache(client, path):
    r = client.get(path)
    assert r.status_code == 200 and r.text == INDEX
    assert r.headers["cache-control"] == "no-cache"
    assert r.headers["content-type"].startswith("text/html")


def test_hashed_assets_are_immutable_with_right_types(client):
    js = client.get("/assets/index-abc123.js")
    assert js.status_code == 200 and "immutable" in js.headers["cache-control"]
    assert js.headers["content-type"].startswith("text/javascript")  # module scripts refuse text/plain (Windows registry)
    assert client.get("/assets/index-abc123.css").headers["content-type"].startswith("text/css")


def test_other_files_of_dist_revalidate(client):
    r = client.get("/favicon.svg")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-cache"
    assert r.headers["content-type"].startswith("image/svg+xml")


@pytest.mark.parametrize("path", ["/assets/gone-123.js", "/assets/sub/route", "/nope.png", "/logo.svg"])
def test_missing_files_are_404_not_the_page(client, path):
    r = client.get(path)
    assert r.status_code == 404 and r.text != INDEX


@pytest.mark.parametrize("path", ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt"])
def test_nothing_outside_dist(client, path):
    assert "outside dist" not in client.get(path).text


def test_api_is_never_shadowed(client):
    assert client.get("/api/health").json()["ok"] is True
    r = client.get("/api/no-such-route")
    assert r.status_code == 404 and r.headers["content-type"].startswith("application/json")
    assert client.post("/api/health").status_code == 405  # a GET route of the API, not the page
    assert client.get("/api").status_code == 404
    assert client.get("/openapi.json").json()["info"]["title"]


def test_head_and_writes(client):
    assert client.head("/settings").status_code == 200
    assert client.post("/settings").status_code == 405


def test_guard_covers_the_page(client):
    assert client.get("/", headers={"Host": "evil.com"}).status_code == 400
    assert client.get("/", headers={"Host": "127.0.0.1:5173"}).status_code == 200


def test_without_dist_a_hint(client, dist, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "FRONTEND_DIST", tmp_path / "missing")
    r = client.get("/library")
    assert r.status_code == 404 and "npm" in r.text
    assert client.get("/api/health").status_code == 200


def test_serve_listens_on_both_ports(monkeypatch):
    import uvicorn

    from backend import serve

    def free_port() -> int:
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]

    api, ui = free_port(), free_port()
    monkeypatch.setattr(config, "PORT", api)
    monkeypatch.setattr(config, "FRONTEND_PORT", ui)
    seen: list[int] = []

    def run(self, sockets=None):
        seen.extend(s.getsockname()[1] for s in sockets)
        for s in sockets:
            s.close()

    monkeypatch.setattr(uvicorn.Server, "run", run)
    serve.main()
    assert sorted(seen) == sorted([api, ui])

    seen.clear()
    monkeypatch.setattr(config, "FRONTEND_PORT", api)  # same port twice: one socket
    serve.main()
    assert seen == [api]
