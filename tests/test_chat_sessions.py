"""
Chat sessions (branches), our own context window (compression, files of the session) and lesson bookmarks.
"""


import pytest
from fastapi.testclient import TestClient


class FakeProvider:
    model = "fake"
    can_see_images = False

    def __init__(self):
        self.chats, self.compactions = [], []

    def chat(self, messages, system, images=None, **kw):
        self.chats.append(messages)
        return f"ответ {len(self.chats)} [00:01]"

    def stream_chat(self, messages, system, images=None, **kw):  # like the real base: the whole answer as one piece
        yield self.chat(messages, system, images=images, **kw)

    def generate_text(self, prompt, system="", **kw):
        self.compactions.append(prompt)
        return "СВОДКА: говорили о типах"


@pytest.fixture()
def lesson_api(data_dir, monkeypatch):
    from backend.main import app
    from backend.models.lesson import Lesson
    from backend.services import assistant
    from backend.services.storage import Lessons
    from backend.utils.fs import write_json

    Lessons.save(Lesson(id="less_x", job_id="x", title="Урок", clean_duration_sec=60))
    write_json(data_dir / "output" / "x" / "segments.json", [{"clean_start": 0, "clean_end": 2, "orig_start": 0, "orig_end": 2, "text": "типы данных"}])
    fake = FakeProvider()
    monkeypatch.setattr(assistant.AI, "get", staticmethod(lambda name: fake))
    with TestClient(app, base_url="http://127.0.0.1") as c:
        yield c, fake


def ask(c, text, **extra):
    r = c.post("/api/assistant/lesson/less_x", json={"question": text, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def test_legacy_thread_becomes_one_session(data_dir):
    from backend.services import chats
    from backend.services.storage import LibraryDB

    with LibraryDB.tx() as db:
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


def test_history_is_compressed_before_it_outgrows_its_share(lesson_api, monkeypatch):
    from backend.services import context_window

    c, fake = lesson_api
    assert c.patch("/api/settings", json={"ai": {"context_tokens": {"deepseek": 8_000}}}).status_code == 200
    share = context_window.window_for("deepseek") * context_window.SHARE_HISTORY
    assert share == 5_250  # the smallest window
    for i in range(5):
        t = ask(c, f"вопрос {i} " + "x" * 1600)
        s = t["session"]
        verbatim = len(s["summary"]) + sum(len(m["content"]) for m in s["messages"][s["summarized"]:])
        # never past the line after an answer: the next question starts below it
        assert verbatim <= share or len(s["messages"]) - s["summarized"] <= context_window.MIN_KEEP
    assert fake.compactions and "вопрос 0" in fake.compactions[0]
    assert s["summary"].startswith("СВОДКА") and s["summarized"] >= 2
    # what was sent: the summary, then only the recent messages verbatim, within the history share
    sent = fake.chats[-1]
    assert any("SUMMARY OF THE START" in m["content"] for m in sent)
    assert not any(m["content"].startswith("вопрос 0") for m in sent)
    assert len(s["messages"]) == 10  # nothing is lost for reading


def test_a_huge_history_is_folded_in_chunks_that_fit_the_window():
    from backend.models.assistant import ChatMessage, ChatSession
    from backend.services import context_window

    calls = []

    class P:
        def generate_text(self, prompt, system=""):
            calls.append(len(prompt))
            return "СВОДКА"

    window = 20_000
    msgs = [ChatMessage(id=str(i), role="user" if i % 2 == 0 else "assistant", content="y" * 9_000) for i in range(12)]
    session = ChatSession(id="s", messages=msgs)
    context_window.compact(P(), session, window)
    assert len(calls) > 1 and max(calls) <= window * context_window.CHUNK_SHARE + 3_000  # each call fits
    assert session.summarized == 12 - context_window.MIN_KEEP  # big answers: only the last exchange stays verbatim


def test_the_history_never_crowds_out_the_material():
    from backend.models.assistant import ChatMessage, ChatSession
    from backend.models.lesson import LessonFull
    from backend.services import context_window

    window = 30_000
    lesson = LessonFull(id="l", job_id="l", title="L", plain_text="z" * 12_000)
    msgs = [ChatMessage(id=str(i), role="user" if i % 2 == 0 else "assistant", content="h" * 4_000) for i in range(10)]
    req = context_window.build(provider_name="deepseek", window=window, vision=False, sources=[lesson], session=ChatSession(id="s", messages=msgs))
    # within the share, except the last exchange, which always goes whole
    assert req.usage.history <= max(window * context_window.SHARE_HISTORY, 2 * 4_000)
    assert sum(1 for m in req.messages if m['content'].startswith('h')) == context_window.MIN_KEEP
    assert not req.usage.sources_trimmed  # the lesson goes whole: no "switch the model" notice


def test_session_files_live_in_the_session_folder_and_go_only_when_attached(lesson_api, data_dir):
    import json

    c, fake = lesson_api
    sid = c.get("/api/assistant/lesson/less_x").json()["session"]["id"]  # a fresh session, not saved yet
    folder = data_dir / "sessions" / sid
    # a pasted screenshot or a file is kept in the session's folder at once, before any question
    doc = c.put(f"/api/assistant/attachments/spec.md?session={sid}", content=b"# Spec\nparser must be strict").json()
    assert doc["session"] == sid and (folder / "local_session_src" / doc["id"] / "spec.md").is_file()

    t = ask(c, "что в файле?", session_id=sid, attachments=[doc["id"]])
    assert "parser must be strict" in fake.chats[-1][-1]["content"] and t["context"]["files"] == 0  # next question: none
    assert [f["name"] for f in t["files"]] == ["spec.md"]  # offered to attach again
    context = json.loads((folder / "context" / "session.json").read_text())
    assert context["thread"] == "lesson:less_x" and context["messages"][0]["attachments"][0]["id"] == doc["id"]

    ask(c, "а подробнее?", session_id=sid)  # not attached: not sent
    assert "parser must be strict" not in fake.chats[-1][-1]["content"]
    ask(c, "ещё раз по файлу", session_id=sid, attachments=[doc["id"]])  # attached again: no new upload
    assert "parser must be strict" in fake.chats[-1][-1]["content"]

    other = c.post("/api/assistant/lesson/less_x/sessions").json()["id"]
    ask(c, "чужой файл", session_id=other, attachments=[doc["id"]])  # another session's file is not reachable
    assert "parser must be strict" not in fake.chats[-1][-1]["content"]

    # a draft chip removed: an unsent file goes, a sent one stays with the history
    draft = c.put(f"/api/assistant/attachments/draft.txt?session={sid}", content=b"draft text").json()
    c.delete(f"/api/assistant/attachments/{draft['id']}?session={sid}")
    c.delete(f"/api/assistant/attachments/{doc['id']}?session={sid}")
    names = [f["name"] for f in c.get(f"/api/assistant/lesson/less_x?session={sid}").json()["files"]]
    assert names == ["spec.md"]

    # clearing the session drops its history and its files
    c.post(f"/api/assistant/lesson/less_x/sessions/{sid}/clear")
    t = c.get(f"/api/assistant/lesson/less_x?session={sid}").json()
    assert t["session"]["messages"] == [] and t["files"] == [] and t["context"]["history"] == 0
    assert c.get(f"/api/assistant/attachments/{doc['id']}/file").status_code == 404
    c.delete(f"/api/assistant/lesson/less_x/sessions/{sid}")
    assert not folder.exists()


def test_old_sessions_move_out_of_the_database(lesson_api, data_dir):
    from backend.services import attachments, chats
    from backend.services.storage import LibraryDB

    c, fake = lesson_api
    att_id, path = attachments.new_slot("old.md")  # an upload of the old layout: the shared folder
    path.write_text("old file text")
    old = attachments.register(att_id, path).model_dump()
    message = {"id": "m1", "role": "user", "content": "старый вопрос", "attachments": [old]}
    with LibraryDB.tx() as db:
        db["threads"]["lesson:less_x"] = {"active": "ses_0000aaaa", "sessions": [{"id": "ses_0000aaaa", "messages": [message], "excluded_files": []}]}

    assert chats.migrate() == 1 and chats.migrate() == 0
    assert LibraryDB.read()["threads"]["lesson:less_x"] == {"active": "ses_0000aaaa", "sessions": ["ses_0000aaaa"]}
    moved = data_dir / "sessions" / "ses_0000aaaa" / "local_session_src" / att_id / "old.md"
    assert moved.read_text() == "old file text" and not (data_dir / "attachments" / att_id).exists()
    t = c.get("/api/assistant/lesson/less_x").json()
    assert t["session"]["messages"][0]["attachments"][0]["session"] == "ses_0000aaaa" and [f["name"] for f in t["files"]] == ["old.md"]
    assert c.get(f"/api/assistant/attachments/{att_id}/file").content == b"old file text"


def test_context_usage_reports_the_window(lesson_api):
    c, _ = lesson_api
    ctx = c.get("/api/assistant/lesson/less_x?provider=gemini").json()["context"]
    assert ctx["window_tokens"] == 400_000 and ctx["window"] == 400_000 * 7 // 8 * 3 and ctx["provider"] == "gemini"
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
    from backend.services.storage import Lessons

    Lessons.save(Lesson(id="less_b", job_id="b", title="Урок"))
    with TestClient(app, base_url="http://127.0.0.1") as c:
        r = c.patch("/api/lessons/less_b", json={"bookmarks": [{"id": "b2", "t": 90, "label": "вторая"}, {"id": "b1", "t": 12.5, "label": "первая"}]})
        assert r.status_code == 200, r.text
        assert [b["id"] for b in r.json()["bookmarks"]] == ["b1", "b2"]  # kept in time order
        assert c.patch("/api/lessons/less_b", json={"bookmarks": [{"id": "x", "t": 1, "label": "x" * 21}]}).status_code == 422
        assert c.patch("/api/lessons/less_b", json={"title": "Новое"}).json()["bookmarks"][0]["label"] == "первая"  # other patches keep them


def test_notebook_cover(data_dir):
    from test_attachments import PNG as png

    from backend.main import app
    with TestClient(app, base_url="http://127.0.0.1") as c:
        pid = c.post("/api/projects", json={"name": "Курс"}).json()["id"]
        assert c.put(f"/api/projects/{pid}/cover", content=b"not an image").status_code == 400
        p = c.put(f"/api/projects/{pid}/cover", content=png).json()
        assert p["cover"].startswith(pid) and p["cover"].endswith(".png")
        r = c.get(f"/api/projects/{pid}/cover")
        assert r.status_code == 200 and r.content == png and r.headers["content-type"] == "image/png"
        assert (data_dir / "covers" / p["cover"]).is_file()
        c.delete(f"/api/projects/{pid}")
        assert not list((data_dir / "covers").glob(f"{pid}-*"))
        assert c.get(f"/api/projects/{pid}/cover").status_code == 404


# ---------------------------------------------------------------- the window size (Settings → AI)


def test_window_limits_are_checked_by_the_server(lesson_api):
    c, _ = lesson_api
    providers = c.get("/api/settings/providers").json()
    assert providers["deepseek"]["max_context_tokens"] == 128_000 and providers["gemini"]["max_context_tokens"] == 1_000_000
    assert providers["deepseek"]["min_context_tokens"] == 8_000 and providers["deepseek"]["default_context_tokens"] == 64_000

    def set_window(values):
        return c.patch("/api/settings", json={"ai": {"context_tokens": values}})

    assert set_window({"deepseek": 7_999}).status_code == 422
    assert set_window({"deepseek": 128_001}).status_code == 422
    assert set_window({"mistral": 64_000}).status_code == 422  # not a provider
    r = set_window({"gemini": 1_000_000, "deepseek": 96_000})
    assert r.status_code == 200 and r.json()["ai"]["context_tokens"] == {"gemini": 1_000_000, "deepseek": 96_000}
    r = set_window({"gemini": None})  # back to the default; the other one stays
    assert r.json()["ai"]["context_tokens"] == {"deepseek": 96_000}


def test_window_comes_from_the_settings(lesson_api):
    import json

    from backend.core.ai import AI
    from backend.services import context_window
    from backend.settings import service

    c, _ = lesson_api
    raw = json.loads(service.SETTINGS_FILE.read_text())
    assert "ai" not in raw  # the test settings.json predates this setting: the defaults
    assert AI.context_tokens("deepseek") == 64_000 and AI.context_tokens("gemini") == 400_000
    assert context_window.window_for("deepseek") == 64_000 * 7 // 8 * 3

    c.patch("/api/settings", json={"ai": {"context_tokens": {"deepseek": 128_000}}})
    assert context_window.window_for("deepseek") == 128_000 * 7 // 8 * 3

    # a hand-edited value outside the model's limits is clamped, never sent as is
    raw = json.loads(service.SETTINGS_FILE.read_text())
    raw["ai"]["context_tokens"] = {"deepseek": 5_000_000, "gemini": 10}
    service.SETTINGS_FILE.write_text(json.dumps(raw))
    service.SettingsService._cache = None
    assert AI.context_tokens("deepseek") == 128_000 and AI.context_tokens("gemini") == 8_000


def test_meter_shows_tokens(lesson_api):
    c, _ = lesson_api
    c.patch("/api/settings", json={"ai": {"context_tokens": {"deepseek": 32_000}}})
    usage = c.get("/api/assistant/lesson/less_x").json()["context"]
    assert usage["window_tokens"] == 32_000 and usage["window"] == 32_000 * 7 // 8 * 3
    assert usage["total"] > 0 and usage["total_tokens"] == -(-usage["total"] // 3)


def test_a_file_pasted_before_the_first_question_lands_in_its_session(lesson_api):
    c, fake = lesson_api
    first = c.get("/api/assistant/lesson/less_x").json()["session"]["id"]
    assert c.get("/api/assistant/lesson/less_x?provider=gemini").json()["session"]["id"] == first  # stable until saved
    shot = c.put(f"/api/assistant/attachments/shot.txt?session={first}", content=b"pasted before asking").json()
    t = ask(c, "что на скриншоте?", session_id=first, attachments=[shot["id"]])
    assert t["session"]["id"] == first and "pasted before asking" in fake.chats[-1][-1]["content"]


def test_the_assistant_may_answer_beyond_the_lecture():
    from backend.core.ai import prompts

    system = prompts.assistant_system("qa", multi_source=False)
    assert "Beyond the lecture:" in system and "Answer only from the sources" not in system


def test_streamed_answer_arrives_in_pieces_and_is_saved(lesson_api, monkeypatch):
    import json

    c, fake = lesson_api
    monkeypatch.setattr(fake, "stream_chat", lambda *a, **k: iter(["Ответ ", "по уроку ", "[00:01]"]), raising=False)
    r = c.post("/api/assistant/lesson/less_x/stream", json={"question": "что было?"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/x-ndjson")
    events = [json.loads(line) for line in r.text.splitlines() if line]
    assert [e["text"] for e in events if e["type"] == "delta"] == ["Ответ ", "по уроку ", "[00:01]"]
    done = events[-1]
    assert done["type"] == "done" and done["thread"]["session"]["messages"][-1]["content"] == "Ответ по уроку [00:01]"
    assert c.get("/api/assistant/lesson/less_x").json()["session"]["messages"][-1]["content"] == "Ответ по уроку [00:01]"


def test_streamed_error_is_an_event_and_saves_nothing(lesson_api, monkeypatch):
    import json

    c, fake = lesson_api

    def broken(*a, **k):
        yield "начало "
        raise RuntimeError("сеть упала")

    monkeypatch.setattr(fake, "stream_chat", broken, raising=False)
    events = [json.loads(line) for line in c.post("/api/assistant/lesson/less_x/stream", json={"question": "?"}).text.splitlines()]
    assert events[0] == {"type": "delta", "text": "начало "} and events[-1]["type"] == "error" and "сеть упала" in events[-1]["detail"]
    assert not c.get("/api/assistant/lesson/less_x").json()["session"]["messages"]


def test_stream_refuses_before_starting(lesson_api):
    assert lesson_api[0].post("/api/assistant/lesson/less_nope/stream", json={"question": "?"}).status_code == 404
