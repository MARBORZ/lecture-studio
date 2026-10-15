import threading

from fastapi.testclient import TestClient

from backend.models.lesson import Lesson, LessonPatch


def test_storage_concurrent_writes(data_dir):
    from backend.services.storage import Library

    Library.save_lesson(Lesson(id="less_a", job_id="a"))
    threads = [threading.Thread(target=Library.patch_lesson, args=("less_a", LessonPatch(tags=str(i)))) for i in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert Library.get_lesson("less_a") is not None
    assert len(Library.list_lessons()) == 1


def test_patch_is_partial(data_dir):
    from backend.main import app
    from backend.services.storage import Library

    Library.save_lesson(Lesson(id="less_b", job_id="b", status="completed", notes="keep"))
    with TestClient(app) as c:
        r = c.patch("/api/lessons/less_b", json={"title": "New"}).json()
    assert (r["title"], r["status"], r["notes"]) == ("New", "completed", "keep")


def test_shutdown_refused_while_busy(data_dir, monkeypatch):
    from backend.main import app
    from backend.services.jobs import JobRegistry

    job = JobRegistry.create("process", "Урок", ["extract"])
    JobRegistry.update(job.id, status="processing", progress=40)
    killed = []
    monkeypatch.setattr("backend.api.routes.system._stop_everything", lambda: killed.append(1))
    with TestClient(app) as c:
        r = c.post("/api/system/shutdown")
        assert r.status_code == 409
        assert c.get("/api/system/status").json()["busy"] is True
        JobRegistry.update(job.id, status="completed")
        assert c.post("/api/system/shutdown").status_code == 200
    import time

    time.sleep(1.5)
    assert killed == [1]


def test_onboarding_flag(data_dir):
    from backend.main import app

    with TestClient(app) as c:
        assert c.get("/api/settings").json()["onboarding_done"] is False  # fresh install -> tutorial
        r = c.patch("/api/settings", json={"ui_language": "en", "onboarding_done": True}).json()
        assert (r["ui_language"], r["onboarding_done"]) == ("en", True)
        assert c.patch("/api/settings", json={"export_dir": ""}).json()["onboarding_done"] is True  # untouched by other patches

