"""
Chat sessions (branches), our own context window (compression, files of the session) and lesson bookmarks.
"""


import pytest
from fastapi.testclient import TestClient


class FakeProvider:
    model = "fake"
    can_see_images = False

    def __init__(self, window=90_000):
        self.context_chars = window
        self.chats, self.compactions = [], []

    def chat(self, messages, system, images=None, **kw):
        self.chats.append(messages)
        return f"ответ {len(self.chats)} [00:01]"

    def generate_text(self, prompt, system="", **kw):
        self.compactions.append(prompt)
        return "СВОДКА: говорили о типах"


@pytest.fixture()
def lesson_api(data_dir, monkeypatch):
    from backend.main import app
    from backend.models.lesson import Lesson
    from backend.services import assistant
    from backend.services.storage import Library
    from backend.utils.fs import write_json

    Library.save_lesson(Lesson(id="less_x", job_id="x", title="Урок", clean_duration_sec=60))
    write_json(data_dir / "output" / "x" / "segments.json", [{"clean_start": 0, "clean_end": 2, "orig_start": 0, "orig_end": 2, "text": "типы данных"}])
    fake = FakeProvider()
    monkeypatch.setattr(assistant.AI, "get", staticmethod(lambda name: fake))
    with TestClient(app) as c:
        yield c, fake


def ask(c, text, **extra):
    r = c.post("/api/assistant/lesson/less_x", json={"question": text, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def test_legacy_thread_becomes_one_session(data_dir):
    from backend.services import chats
    from backend.services.storage import Library

    with Library.tx() as db:
        db["threads"]["lesson:less_x"] = [
            {"id": "1", "role": "user", "content": "что такое тип?"},
            {"id": "2", "role": "assistant", "content": "категория значений"},
        ]
    session, infos = chats.get("lesson", "less_x")
    assert len(session.messages) == 2 and session.title == "что такое тип?" and len(infos) == 1


def test_sessions_are_separate_branches(lesson_api):
    c, fake = lesson_api
    first = ask(c, "про типы")
    s1 = first["session"]["id"]
    assert first["session"]["title"] == "про типы" and len(first["session"]["messages"]) == 2

    s2 = c.post("/api/assistant/lesson/less_x/sessions").json()["id"]
    assert s2 != s1
    second = ask(c, "про антипаттерны", session_id=s2)
    # the new branch does not carry the first one's history
    assert not any("про типы" in m["content"] for m in fake.chats[-1])
    assert {s["id"] for s in second["sessions"]} == {s1, s2}

    # the active one is the last used; switching back works
    assert c.get("/api/assistant/lesson/less_x").json()["session"]["id"] == s2
    c.put(f"/api/assistant/lesson/less_x/sessions/{s1}/active")
    assert c.get("/api/assistant/lesson/less_x").json()["session"]["id"] == s1

    c.patch(f"/api/assistant/lesson/less_x/sessions/{s1}", json={"title": "Типы"})
    c.delete(f"/api/assistant/lesson/less_x/sessions/{s2}")
    t = c.get("/api/assistant/lesson/less_x").json()
    assert [s["title"] for s in t["sessions"]] == ["Типы"]


def test_first_question_into_a_fresh_unsaved_session(lesson_api):
    c, _ = lesson_api
    fresh = c.get("/api/assistant/lesson/less_x").json()["session"]["id"]
    assert ask(c, "вопрос", session_id=fresh)["session"]["id"] == fresh
    assert c.get("/api/assistant/lesson/less_x?session=ses_00000000").status_code == 404


def test_history_is_compressed_when_it_outgrows_its_share(lesson_api, monkeypatch):
    from backend.services import context_window

    c, fake = lesson_api
    fake.context_chars = 8_000  # tiny window: history share = 2000 chars
    for i in range(4):
        ask(c, f"вопрос {i} " + "x" * 600)
    assert not fake.compactions
    t = ask(c, "ещё вопрос " + "x" * 600)
    assert len(fake.compactions) == 1 and "вопрос 0" in fake.compactions[0]
    s = t["session"]
    assert s["summary"].startswith("СВОДКА") and s["summarized"] == len(s["messages"]) - 2 - context_window.KEEP_RECENT
    # what was sent: the summary, then only the recent messages verbatim
    sent = fake.chats[-1]
    assert any("СВОДКА НАЧАЛА" in m["content"] for m in sent)
    assert not any(m["content"].startswith("вопрос 0") for m in sent)
    assert len(s["messages"]) == 10  # nothing is lost for reading


def test_files_stay_in_the_session_until_switched_off(lesson_api):
    c, fake = lesson_api
    doc = c.put("/api/assistant/attachments/spec.md", content=b"# Spec\nparser must be strict").json()
    t = ask(c, "что в файле?", attachments=[doc["id"]])
    sid = t["session"]["id"]
    assert [f["name"] for f in t["files"]] == ["spec.md"] and t["context"]["files"] > 0

    ask(c, "а подробнее?", session_id=sid)  # not attached again
    assert "parser must be strict" in fake.chats[-1][-1]["content"]

    c.patch(f"/api/assistant/lesson/less_x/sessions/{sid}", json={"excluded_files": [doc["id"]]})
    ask(c, "без файла", session_id=sid)
    assert "parser must be strict" not in fake.chats[-1][-1]["content"]

    # clearing the session drops its context and its files
    c.post(f"/api/assistant/lesson/less_x/sessions/{sid}/clear")
    t = c.get(f"/api/assistant/lesson/less_x?session={sid}").json()
    assert t["session"]["messages"] == [] and t["files"] == [] and t["context"]["history"] == 0
    assert c.get(f"/api/assistant/attachments/{doc['id']}/file").status_code == 404


def test_context_usage_reports_the_window(lesson_api):
    c, _ = lesson_api
    ctx = c.get("/api/assistant/lesson/less_x?provider=gemini").json()["context"]
    assert ctx["window"] == 600_000 and ctx["provider"] == "gemini"
    assert ctx["sources"] > 0 and ctx["total"] >= ctx["sources"] + ctx["system"]


def test_manual_compact(lesson_api):
    c, fake = lesson_api
    for i in range(3):
        t = ask(c, f"вопрос {i}")
    t = c.post(f"/api/assistant/lesson/less_x/sessions/{t['session']['id']}/compact", json={}).json()
    assert t["session"]["summarized"] == 4 and len(fake.compactions) == 1


def test_bookmarks(data_dir):
    from backend.main import app
    from backend.models.lesson import Lesson
    from backend.services.storage import Library

    Library.save_lesson(Lesson(id="less_b", job_id="b", title="Урок"))
    with TestClient(app) as c:
        r = c.patch("/api/lessons/less_b", json={"bookmarks": [{"id": "b2", "t": 90, "label": "вторая"}, {"id": "b1", "t": 12.5, "label": "первая"}]})
        assert r.status_code == 200, r.text
        assert [b["id"] for b in r.json()["bookmarks"]] == ["b1", "b2"]  # kept in time order
        assert c.patch("/api/lessons/less_b", json={"bookmarks": [{"id": "x", "t": 1, "label": "x" * 21}]}).status_code == 422
        assert c.patch("/api/lessons/less_b", json={"title": "Новое"}).json()["bookmarks"][0]["label"] == "первая"  # other patches keep them
