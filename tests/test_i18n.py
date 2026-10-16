"""
The server speaks the interface language: messages (backend/i18n.py), the Inbox name, and the queue limit refusal.
"""

import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def api(data_dir, monkeypatch):
    from backend import i18n
    from backend.main import app

    monkeypatch.setattr(i18n, "lang", i18n.REAL_LANG)  # follow settings.json, not the test default
    with TestClient(app, base_url="http://127.0.0.1") as c:
        yield c


def test_messages_follow_the_interface_language(api):
    assert api.get("/api/lessons/less_nope").json()["detail"] == "Урок не найден"  # Russian by default
    api.patch("/api/settings", json={"ui_language": "en"})
    assert api.get("/api/lessons/less_nope").json()["detail"] == "Lesson not found"
    assert api.get("/api/jobs/nope").json()["detail"] == "Job not found"


def test_parameters_and_formats_in_both_languages(api):
    from backend.i18n import tr

    assert tr("step.av_drift", drift=0.4) == "Расхождение длительности видео и аудио: +0.40 с"
    api.patch("/api/settings", json={"ui_language": "en"})
    assert tr("step.av_drift", drift=-0.4) == "Video and audio lengths differ by -0.40 s"


def test_inbox_name_is_left_to_the_interface(api, data_dir):
    from backend.models.project import INBOX_ID

    inbox = next(p for p in api.get("/api/projects").json() if p["id"] == INBOX_ID)
    assert inbox["name"] == "" and inbox["description"] == ""  # the UI shows "Входящие" / "Inbox"

    renamed = api.patch(f"/api/projects/{INBOX_ID}", json={"name": "Разное"}).json()
    assert renamed["name"] == "Разное"  # a name the user gives is kept as is


def test_old_russian_inbox_defaults_count_as_unset(api, data_dir):
    from backend.models.project import INBOX_ID
    from backend.settings import paths

    paths().db.write_text(json.dumps({"projects": [{"id": INBOX_ID, "name": "Входящие", "description": "Неразобранные записи"}], "lessons": []}))
    inbox = next(p for p in api.get("/api/projects").json() if p["id"] == INBOX_ID)
    assert inbox["name"] == "" and inbox["description"] == ""


def test_queue_limit_refuses_with_429(api, tmp_path, monkeypatch):
    from backend.api.routes import jobs as jobs_route
    from backend.i18n import tr
    from backend.services.jobs import JobRegistry, QueueFull

    monkeypatch.setattr(JobRegistry, "_jobs", {})
    assert api.patch("/api/settings", json={"queue_limit": 0}).status_code == 422
    assert api.patch("/api/settings", json={"queue_limit": 101}).status_code == 422
    assert api.patch("/api/settings", json={"queue_limit": 2}).json()["queue_limit"] == 2

    JobRegistry.create("process", "a", [])
    JobRegistry.create("process", "b", [])
    with pytest.raises(QueueFull):
        JobRegistry.create("process", "c", [])

    clip = tmp_path / "lecture.mp4"
    clip.write_bytes(b"x")
    monkeypatch.setattr(jobs_route, "_check", lambda media: None)
    r = api.post("/api/jobs", json={"options": {"local_path": str(clip)}})
    assert r.status_code == 429 and r.json()["detail"] == tr("queue.full", n=2)

    # finished jobs do not count
    for job in JobRegistry.list():
        JobRegistry.update(job.id, status="completed")
    assert JobRegistry.create("process", "d", []).status == "pending"
