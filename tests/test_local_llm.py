"""The local model provider (Ollama / LM Studio) against a fake server, its settings, and audits sized to a small window."""

import json
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient

from backend.core.ai import base, prompts
from backend.core.ai.providers import local
from backend.core.ai.retry import AIUnavailable


class FakeServer:
    """mode "ollama": /api/version, /api/tags, /api/show, /api/chat; mode "openai" (LM Studio): /v1/models, /api/v0/models,
    /v1/chat/completions. Every request body is kept in .seen."""

    def __init__(self, mode: str, reply: str = "<think>hmm</think>Ответ модели"):
        self.mode, self.reply, self.seen = mode, reply, []
        server = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, code, data):
                body = json.dumps(data).encode()
                self.send_response(code)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                ollama = server.mode == "ollama"
                if self.path == "/api/version" and ollama:
                    return self._send(200, {"version": "0.12.0"})
                if self.path == "/api/tags" and ollama:
                    return self._send(200, {"models": [{"name": "llama3:latest"}, {"name": "qwen3:8b"}]})
                if self.path == "/v1/models" and not ollama:
                    return self._send(200, {"data": [{"id": "google/gemma-3-12b"}, {"id": "qwen2.5-7b-instruct"}]})
                if self.path == "/api/v0/models" and not ollama:
                    return self._send(200, {"data": [{"id": "google/gemma-3-12b", "max_context_length": 131072}]})
                self._send(404, {"error": "not found"})

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["content-length"])) or b"{}")
                server.seen.append((self.path, body))
                if self.path == "/api/show" and server.mode == "ollama":
                    return self._send(200, {"model_info": {"llama.context_length": 8192 if "llama" in body["model"] else 40960}})
                if self.path == "/api/chat" and server.mode == "ollama":
                    if body["model"] == "missing":
                        return self._send(404, {"error": "model 'missing' not found"})
                    return self._send(200, {"message": {"role": "assistant", "content": server.reply}})
                if self.path == "/v1/chat/completions" and server.mode == "openai":
                    return self._send(200, {"choices": [{"message": {"content": server.reply}}]})
                self._send(404, {"error": "not found"})

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}/v1"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown()


@pytest.fixture()
def ollama():
    s = FakeServer("ollama")
    yield s
    s.close()


@pytest.fixture()
def lmstudio():
    s = FakeServer("openai")
    yield s
    s.close()


def free_url() -> str:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return f"http://127.0.0.1:{s.getsockname()[1]}/v1"  # closed again: nothing listens there


# ---------------------------------------------------------------- server and transport


def test_inspect_ollama_lists_models_with_their_context(ollama):
    info = local.inspect(ollama.url)
    assert (info.ok, info.kind) == (True, "ollama")
    assert [(m.id, m.context_tokens) for m in info.models] == [("llama3:latest", 8192), ("qwen3:8b", 40960)]


def test_inspect_lmstudio(lmstudio):
    info = local.inspect(lmstudio.url)
    assert (info.ok, info.kind) == (True, "openai")
    assert [(m.id, m.context_tokens) for m in info.models] == [("google/gemma-3-12b", 131072), ("qwen2.5-7b-instruct", None)]


def test_inspect_nothing_running():
    url = free_url()
    info = local.inspect(url)
    assert not info.ok and url in info.error and "Ollama" in info.error


def test_ollama_chat_sets_the_window_and_drops_thinking(ollama):
    p = local.LocalProvider(model="qwen3:8b", base_url=ollama.url, context_tokens=16_000)
    assert p.chat([{"role": "user", "content": "Привет"}], system="Будь краток") == "Ответ модели"
    path, body = ollama.seen[-1]
    assert path == "/api/chat" and body["options"]["num_ctx"] == 16_000 and body["stream"] is False
    assert body["messages"][0] == {"role": "system", "content": "Будь краток"}


def test_lmstudio_chat_goes_through_openai(lmstudio):
    p = local.LocalProvider(model="google/gemma-3-12b", base_url=lmstudio.url)
    assert p.generate_text("Привет") == "Ответ модели"
    assert lmstudio.seen[-1][0] == "/v1/chat/completions"


def test_a_server_that_is_not_running_fails_at_once():
    p = local.LocalProvider(model="llama3", base_url=free_url())
    started = time.monotonic()
    with pytest.raises(AIUnavailable) as e:
        p.generate_text("Привет")
    assert time.monotonic() - started < 3  # no retries with pauses
    assert "Ollama" in str(e.value) and "LM Studio" in str(e.value)


def test_unknown_model_names_it(ollama):
    with pytest.raises(Exception) as e:
        local.LocalProvider(model="missing", base_url=ollama.url).generate_text("Привет")
    assert "missing" in str(e.value)


def test_no_model_no_provider():
    with pytest.raises(ValueError):
        local.LocalProvider(model="", base_url=local.DEFAULT_URL)


# ---------------------------------------------------------------- audit in a small window


class Recorder(base.BaseAIProvider):
    category = "recorder-test"

    def __init__(self, window: int | None):
        self.api_key, self.model, self.window, self.calls = "-", "m", window, []

    def audit_window_tokens(self):
        return self.window

    def generate_text(self, prompt, system="", temperature=0.2, **kw):
        self.calls.append(len(prompt) + len(system))
        return "## Заметки\n- [00:10] пункт\n" * 40  # ~1 000 characters of notes per part

    def chat(self, messages, system="", temperature=0.2, **kw):
        raise NotImplementedError


def transcript(chars: int) -> str:
    lines, n = [], 0
    while sum(len(x) + 1 for x in lines) < chars:
        lines.append(f"[{n // 60:02d}:{n % 60:02d}] это фраза из лекции про функции и аргументы номер {n}")
        n += 1
    return "\n".join(lines)


@pytest.mark.parametrize("window", [8_000, 16_000, 32_000])
def test_every_audit_request_fits_a_small_window(window):
    p = Recorder(window)
    p.generate_audit(transcript(200_000), duration=3600, language="ru")
    assert len(p.calls) > 3  # parts and a merge
    assert max(p.calls) <= window * base.CHARS_PER_TOKEN, (window, max(p.calls))


def test_many_parts_merge_in_rounds_in_a_small_window():
    p = Recorder(8_000)
    notes = ["заметка " * 600] * 30  # 30 parts of ~4 800 characters: far more than one 8k request holds
    limit = p._part_limit(prompts.merge_system(True, "ru"))
    joined = p._fit_notes(notes, limit, prompts.merge_system(True, "ru"))
    assert len(joined) <= limit and p.calls  # merged in rounds first
    assert max(p.calls) <= 8_000 * base.CHARS_PER_TOKEN


def test_cloud_parts_unchanged():
    p = Recorder(None)
    assert p._part_limit("x" * 5000) == base.CHUNK_CHARS


# ---------------------------------------------------------------- settings and API


@pytest.fixture()
def client(data_dir):
    from backend.main import app

    with TestClient(app, base_url="http://127.0.0.1") as c:
        yield c


def test_settings_defaults_and_patch(client, ollama):
    ai = client.get("/api/settings").json()["ai"]
    assert ai["local_base_url"] == "http://127.0.0.1:11434/v1" and ai["local_model"] == ""
    providers = client.get("/api/settings/providers").json()
    assert providers["local"]["configured"] is False and providers["local"]["default_context_tokens"] == 8_000

    checked = client.post("/api/settings/local/check", json={"base_url": ollama.url}).json()
    assert checked["ok"] and [m["id"] for m in checked["models"]] == ["llama3:latest", "qwen3:8b"]

    ai = client.patch("/api/settings", json={"ai": {"local_base_url": ollama.url, "local_model": "qwen3:8b", "context_tokens": {"local": 32_000}}}).json()["ai"]
    assert (ai["local_model"], ai["context_tokens"]["local"]) == ("qwen3:8b", 32_000)
    assert client.get("/api/settings/providers").json()["local"]["configured"] is True
    assert client.post("/api/settings/local/check", json={}).json()["kind"] == "ollama"  # the saved address

    test = client.post("/api/settings/test-key", json={"provider": "local"}).json()
    assert test["ok"] and test["model"] == "qwen3:8b"
    assert ollama.seen[-1][1]["options"]["num_ctx"] == 32_000


def test_check_reports_a_stopped_server(client):
    url = free_url()
    r = client.post("/api/settings/local/check", json={"base_url": url}).json()
    assert r["ok"] is False and url in r["error"]


def test_regenerate_audit_with_the_local_model(ollama, data_dir):
    from backend.models.lesson import Lesson
    from backend.services.storage import Library
    from backend.utils.fs import write_json

    Library.save_lesson(Lesson(id="less_loc", job_id="loc", title="Lesson", speech_language="ru"))
    write_json(data_dir / "output" / "loc" / "segments.json", [{"clean_start": 0, "clean_end": 2, "orig_start": 0, "orig_end": 2, "text": "привет"}])

    from backend.main import app

    with TestClient(app, base_url="http://127.0.0.1") as client:  # started after the lesson exists
        r = client.post("/api/lessons/less_loc/audit", json={"provider": "local"})
        assert r.status_code == 400 and "Настройки" in r.json()["detail"]  # no model chosen yet
        ollama.reply = "# Аудит\n- [00:01] привет"
        client.patch("/api/settings", json={"ai": {"local_base_url": ollama.url, "local_model": "llama3:latest"}})
        job = client.post("/api/lessons/less_loc/audit", json={"provider": "local"}).json()
        for _ in range(200):
            state = client.get(f"/api/jobs/{job['id']}").json()
            if state["status"] in ("completed", "error"):
                break
            time.sleep(0.05)
        assert state["status"] == "completed", state
        assert ollama.seen[-1][0] == "/api/chat" and ollama.seen[-1][1]["options"]["num_ctx"] == 8_000
        assert "привет" in client.get("/api/lessons/less_loc").json()["lesson_audit_md"]
