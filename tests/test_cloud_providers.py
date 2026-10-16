"""ChatGPT (OpenAI Chat Completions) and Claude (Anthropic Messages) against faked HTTP answers: no live calls, no keys."""

import json

import httpx
import pytest

from backend.core.ai import retry
from backend.core.ai.providers import anthropic, openai
from backend.core.ai.retry import AIUnavailable, ProviderHTTPError


class Fake:
    """Answers httpx.Client.post / get from a queue of (status, json); keeps what was sent."""

    def __init__(self, monkeypatch, answers):
        self.answers, self.sent = list(answers), []
        fake = self

        def respond(method):
            def handler(client, url, headers=None, json=None, **kw):
                fake.sent.append({"method": method, "url": url, "headers": headers or {}, "json": json})
                status, body = fake.answers.pop(0)
                return httpx.Response(status, json=body, request=httpx.Request(method, url))
            return handler

        monkeypatch.setattr(httpx.Client, "post", respond("POST"))
        monkeypatch.setattr(httpx.Client, "get", respond("GET"))
        monkeypatch.setattr(retry.time, "sleep", lambda s: None)  # retries without the pauses


def chat_answer(text):
    return {"choices": [{"message": {"content": text}}]}


def claude_answer(text):
    return {"content": [{"type": "text", "text": text}], "stop_reason": "end_turn"}


# ---------------------------------------------------------------- ChatGPT


def test_openai_generate_sends_system_and_key(monkeypatch):
    fake = Fake(monkeypatch, [(200, chat_answer("ok"))])
    assert openai.OpenAIProvider("sk-test", "gpt-4.1").generate_text("hi", system="be brief", temperature=0.3) == "ok"
    sent = fake.sent[0]
    assert sent["url"] == "https://api.openai.com/v1/chat/completions" and sent["headers"]["Authorization"] == "Bearer sk-test"
    assert sent["json"]["messages"] == [{"role": "system", "content": "be brief"}, {"role": "user", "content": "hi"}]
    assert sent["json"]["temperature"] == 0.3 and sent["json"]["max_completion_tokens"] > 0


def test_openai_reasoning_models_take_no_temperature(monkeypatch):
    fake = Fake(monkeypatch, [(200, chat_answer("ok"))])
    openai.OpenAIProvider("sk-test", "gpt-5-mini").generate_text("hi")
    assert "temperature" not in fake.sent[0]["json"]


def test_openai_chat_with_an_image(monkeypatch):
    fake = Fake(monkeypatch, [(200, chat_answer("a cat"))])
    out = openai.OpenAIProvider("sk-test").chat([{"role": "user", "content": "what is it?"}], system="s", images=[(b"\x89PNG", "image/png")])
    last = fake.sent[0]["json"]["messages"][-1]
    assert out == "a cat" and last["content"][0] == {"type": "text", "text": "what is it?"}
    assert last["content"][1]["image_url"]["url"].startswith("data:image/png;base64,")


def test_openai_bad_key_fails_at_once(monkeypatch):
    fake = Fake(monkeypatch, [(401, {"error": {"message": "Incorrect API key provided"}})])
    with pytest.raises(ProviderHTTPError) as e:
        openai.OpenAIProvider("sk-bad").generate_text("hi")
    assert e.value.status == 401 and "Incorrect API key" in str(e.value) and len(fake.sent) == 1


def test_openai_rate_limit_is_retried(monkeypatch):
    fake = Fake(monkeypatch, [(429, {"error": {"message": "Rate limit"}}), (200, chat_answer("ok"))])
    assert openai.OpenAIProvider("sk-test").generate_text("hi") == "ok" and len(fake.sent) == 2


def test_openai_model_list_keeps_chat_models(monkeypatch):
    openai._models_cache.clear()
    ids = ["gpt-5", "gpt-5-mini", "gpt-4o-audio-preview", "text-embedding-3-large", "dall-e-3", "o3", "gpt-4o-realtime-preview", "whisper-1"]
    Fake(monkeypatch, [(200, {"data": [{"id": i} for i in ids]})])
    assert openai.list_models("sk-test") == ["o3", "gpt-5-mini", "gpt-5"]
    assert openai.list_models("sk-test") == ["o3", "gpt-5-mini", "gpt-5"]  # cached: the queue is empty, no second call


def test_openai_model_list_falls_back(monkeypatch):
    openai._models_cache.clear()
    Fake(monkeypatch, [(401, {"error": {}})])
    assert openai.list_models("sk-bad") == openai.OpenAIProvider.supported_models


# ---------------------------------------------------------------- Claude


def test_claude_generate_uses_messages_api(monkeypatch):
    fake = Fake(monkeypatch, [(200, claude_answer("ok"))])
    assert anthropic.AnthropicProvider("sk-ant-test").generate_text("hi", system="be brief") == "ok"
    sent = fake.sent[0]
    assert sent["url"] == "https://api.anthropic.com/v1/messages"
    assert sent["headers"]["x-api-key"] == "sk-ant-test" and sent["headers"]["anthropic-version"] == "2023-06-01"
    body = sent["json"]
    assert body["model"] == "claude-sonnet-5-5" and body["system"] == "be brief" and body["max_tokens"] > 0
    assert body["messages"] == [{"role": "user", "content": "hi"}]


def test_claude_chat_with_an_image_and_history(monkeypatch):
    fake = Fake(monkeypatch, [(200, claude_answer("two"))])
    history = [{"role": "user", "content": "one?"}, {"role": "assistant", "content": "one"}, {"role": "user", "content": "and this?"}]
    assert anthropic.AnthropicProvider("k", "claude-haiku-5-5").chat(history, images=[(b"jpg", "image/jpeg")]) == "two"
    body = fake.sent[0]["json"]
    assert "system" not in body and body["messages"][:2] == history[:2]
    blocks = body["messages"][-1]["content"]
    assert blocks[0]["type"] == "image" and blocks[0]["source"]["media_type"] == "image/jpeg" and blocks[-1] == {"type": "text", "text": "and this?"}


def test_claude_bad_key_fails_at_once(monkeypatch):
    fake = Fake(monkeypatch, [(401, {"type": "error", "error": {"type": "authentication_error", "message": "invalid x-api-key"}})])
    with pytest.raises(ProviderHTTPError) as e:
        anthropic.AnthropicProvider("bad").generate_text("hi")
    assert e.value.status == 401 and "invalid x-api-key" in str(e.value) and len(fake.sent) == 1


@pytest.mark.parametrize("status", [429, 529])
def test_claude_overload_and_rate_limit_are_retried(monkeypatch, status):
    fake = Fake(monkeypatch, [(status, {"type": "error", "error": {"type": "overloaded_error"}}), (200, claude_answer("ok"))])
    assert anthropic.AnthropicProvider("k").generate_text("hi") == "ok" and len(fake.sent) == 2


def test_claude_overload_that_lasts_is_explained(monkeypatch):
    Fake(monkeypatch, [(529, {"type": "error", "error": {"type": "overloaded_error"}})] * (len(retry.DELAYS) + 1))
    with pytest.raises(AIUnavailable) as e:
        anthropic.AnthropicProvider("k").generate_text("hi")
    assert "Claude" in str(e.value) and "529" in str(e.value)


# ---------------------------------------------------------------- settings


def test_settings_know_both(data_dir):
    from fastapi.testclient import TestClient

    from backend.main import app

    with TestClient(app, base_url="http://127.0.0.1") as c:
        ai = c.get("/api/settings").json()["ai"]
        assert ai["openai_model"] == "gpt-5-mini" and ai["anthropic_model"] == "claude-sonnet-5-5"
        assert ai["openai_key"]["source"] == "none" and ai["anthropic_key"]["source"] == "none"
        ai = c.patch("/api/settings", json={"ai": {"anthropic_api_key": "sk-ant-api03-abcdefghijklmnop", "assistant_provider": "anthropic"}}).json()["ai"]
        assert ai["anthropic_key"]["source"] == "settings" and "abcdefghijklmnop" not in json.dumps(ai) and ai["assistant_provider"] == "anthropic"
        providers = c.get("/api/settings/providers").json()
        assert providers["anthropic"]["configured"] is True and providers["openai"]["configured"] is False
        assert providers["anthropic"]["default_context_tokens"] == 200_000 and providers["openai"]["default_context_tokens"] == 128_000
        assert c.patch("/api/settings", json={"pipeline": {"audit": "openai", "audit_source": "video"}}).json()["pipeline"]["audit_source"] == "transcript"
