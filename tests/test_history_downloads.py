"""Job history on disk, clearing the Studio list, downloaded videos (used / unused, pages), search pages."""

import os
import time


def _client():
    from fastapi.testclient import TestClient

    from backend.api.app import create_app

    return TestClient(create_app(), base_url="http://127.0.0.1")


def test_finished_jobs_go_to_history_and_leave_the_list_on_clear(data_dir):
    from backend.services.jobs import JobRegistry

    JobRegistry._jobs.clear()
    a = JobRegistry.create("process", "A", [])
    b = JobRegistry.create("process", "B", [])
    JobRegistry.update(a.id, status="completed")
    JobRegistry.update(a.id, status="completed")  # a second final update does not duplicate
    assert [j.title for j in JobRegistry.history().items] == ["A"]
    assert JobRegistry.clear_finished() == 1
    assert [j.id for j in JobRegistry.list()] == [b.id]  # the running one stays
    JobRegistry.update(b.id, status="error")
    page = JobRegistry.history(page=1, size=1)
    assert page.total == 2 and [j.title for j in page.items] == ["B"]  # newest first
    assert JobRegistry.history(page=2, size=1).items[0].title == "A"
    with _client() as c:
        assert c.get("/api/jobs/history?size=10").json()["total"] == 2
        assert c.post("/api/jobs/clear-finished").json()["cleared"] == 1
        assert c.delete("/api/jobs/history").json() == {"ok": True}
        assert c.get("/api/jobs/history").json()["total"] == 0
    JobRegistry._jobs.clear()


def test_downloads_list_pages_used_and_delete(data_dir):
    from backend.services import videos
    from backend.settings import paths

    root = paths().downloads
    root.mkdir(parents=True, exist_ok=True)
    for i, name in enumerate(["Old lecture [aaaaaaaaaaa].mp4", "New lecture [bbbbbbbbbbb].mp4", "notes.txt"]):
        f = root / name
        f.write_bytes(b"x" * 1024)
        os.utime(f, (time.time() + i, time.time() + i))
    page = videos.list_downloads()
    assert [d.title for d in page.items] == ["New lecture", "Old lecture"] and page.total == 2  # newest first, media only
    videos.mark_used(root / "Old lecture [aaaaaaaaaaa].mp4")
    videos.mark_used(data_dir / "elsewhere.mp4")  # outside downloads/: ignored
    assert [d.title for d in videos.list_downloads(unused_only=True).items] == ["New lecture"]
    assert videos.list_downloads(page=2, size=1).items[0].title == "Old lecture"
    with _client() as c:
        assert c.get("/api/videos/downloads?unused=true").json()["total"] == 1
        assert c.delete("/api/videos/downloads/Old lecture [aaaaaaaaaaa].mp4").json() == {"ok": True}
        assert c.delete("/api/videos/downloads/notes.txt").status_code == 404
        assert c.delete("/api/videos/downloads/..%2Fsettings.json").status_code == 404
    assert videos.list_downloads().total == 1


def test_search_asks_for_the_page(monkeypatch):
    from backend.services import videos

    seen = []
    monkeypatch.setattr(videos, "_run", lambda args, timeout: seen.append(args) or '{"entries": []}')
    videos.search("python", page=2)
    assert seen[0][0] == "ytsearch40:python" and seen[0][seen[0].index("--playlist-items") + 1] == "21-40"
    videos.search("python", page=99)
    assert seen[1][0] == f"ytsearch{videos.MAX_PAGES * videos.SEARCH_RESULTS}:python"
