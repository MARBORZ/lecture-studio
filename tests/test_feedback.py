"""Bug reports: honeypot, timing, limits, cooldown, outbox, delivery to the relay, masked secrets."""

import pytest


@pytest.fixture()
def fb(data_dir, monkeypatch, tmp_path):
    import backend.config as config
    from backend.services import feedback

    monkeypatch.setattr(config, "FEEDBACK_DIR", tmp_path / "home" / "feedback")
    monkeypatch.setattr(config, "LOGS_DIR", tmp_path / "home" / "logs")
    monkeypatch.setattr(config, "FEEDBACK_URL", "")
    monkeypatch.setattr(feedback, "MIN_FILL_SEC", 0)
    monkeypatch.setattr(feedback, "_diagnostics", lambda: "diag")
    return feedback


def _client():
    from fastapi.testclient import TestClient

    from backend.api.app import create_app

    return TestClient(create_app())


def _form(**kw):
    from backend.models.feedback import FeedbackSend

    return FeedbackSend(**{"message": "The player stops after a minute", **kw})


def test_send_without_relay_waits_in_the_outbox(fb):
    d = fb.new_draft()
    res = fb.send(d.id, _form())
    assert res.status == "queued" and res.outbox == 1
    queued = fb._queued()[0]
    assert (queued / "report.json").is_file() and (queued / "files" / "diagnostics.txt").read_text() == "diag"


def test_delivered_to_the_relay_and_the_outbox_flushes(fb, monkeypatch):
    import backend.config as config

    fb.send(fb.new_draft().id, _form())  # no relay yet: queued
    posts = []

    class Ok:
        status_code = 200
        text = "ok"

    monkeypatch.setattr(config, "FEEDBACK_URL", "https://relay.example/api/feedback")
    monkeypatch.setattr(fb.httpx, "post", lambda url, **kw: posts.append(kw) or Ok())
    monkeypatch.setattr(fb, "retry_after", lambda: 0)
    res = fb.send(fb.new_draft().id, _form(kind="idea", diagnostics=False))
    assert res.status == "sent" and res.outbox == 0 and len(posts) == 2  # the new one, then the waiting one
    assert posts[0]["data"]["kind"] == "idea" and posts[0]["headers"]["X-Lecture-Studio"]


def test_honeypot_and_too_fast_are_dropped_quietly(fb, monkeypatch):
    d = fb.new_draft()
    assert fb.send(d.id, _form(website="http://spam")).status == "sent"
    assert fb._queued() == [] and fb.retry_after() == 0  # nothing kept, no cooldown spent
    monkeypatch.setattr(fb, "MIN_FILL_SEC", 60)
    assert fb.send(fb.new_draft().id, _form()).status == "sent" and fb._queued() == []


def test_cooldown_and_daily_limit(fb, monkeypatch):
    fb.send(fb.new_draft().id, _form())
    with pytest.raises(fb.TooSoon) as e:
        fb.send(fb.new_draft().id, _form())
    assert 0 < e.value.retry_after <= fb.COOLDOWN_SEC
    monkeypatch.setattr(fb, "COOLDOWN_SEC", 0)
    monkeypatch.setattr(fb, "DAILY_LIMIT", 2)
    fb.send(fb.new_draft().id, _form())
    with pytest.raises(fb.TooSoon) as e:
        fb.send(fb.new_draft().id, _form())
    assert e.value.retry_after > 23 * 3600


def test_message_length(fb):
    with pytest.raises(fb.FeedbackError):
        fb.send(fb.new_draft().id, _form(message="short"))


def test_files_by_type_count_and_size(fb, monkeypatch):
    with _client() as c:
        d = c.post("/api/feedback/drafts").json()
        assert d["limits"]["max_files"] == fb.MAX_FILES
        url = f"/api/feedback/drafts/{d['id']}/files"
        assert c.put(f"{url}/shot.png", content=b"png").json() == {"name": "shot.png", "size": 3}
        assert c.put(f"{url}/run.exe", content=b"x").status_code == 400
        monkeypatch.setattr(fb, "MAX_TOTAL_BYTES", 10)
        monkeypatch.setattr(fb, "MAX_FILE_BYTES", 10)
        assert c.put(f"{url}/big.log", content=b"x" * 20).status_code == 413
        assert not (fb._drafts() / d["id"] / "files" / "big.log").exists()
        monkeypatch.setattr(fb, "MAX_FILES", 1)
        assert c.put(f"{url}/second.txt", content=b"x").status_code == 400
        assert c.delete(f"{url}/shot.png").json() == {"ok": True}
        assert c.put("/api/feedback/drafts/nothere12345/files/a.png", content=b"x").status_code == 400


def test_send_route_answers_429_on_cooldown(fb):
    with _client() as c:
        first = c.post("/api/feedback/drafts").json()["id"]
        assert c.post(f"/api/feedback/drafts/{first}/send", json={"message": "Something is broken here"}).json()["status"] == "queued"
        second = c.post("/api/feedback/drafts").json()
        assert second["retry_after"] > 0
        r = c.post(f"/api/feedback/drafts/{second['id']}/send", json={"message": "Something is broken here"})
        assert r.status_code == 429 and int(r.headers["Retry-After"]) > 0


def test_diagnostics_mask_secrets(data_dir, monkeypatch, tmp_path):
    import backend.config as config
    from backend.services import feedback

    logs = tmp_path / "logs"
    logs.mkdir()
    (logs / "server.log").write_text("error with key sk-abcdef1234567890 and AIzaSyA1234567890abcdefghijk\n")
    monkeypatch.setattr(config, "LOGS_DIR", logs)
    text = feedback._diagnostics()
    assert "sk-abcdef" not in text and "AIzaSy" not in text and "***" in text and config.APP_VERSION in text
