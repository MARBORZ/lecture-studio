"""
OpenAI provider (ChatGPT): Chat Completions. Images in the assistant go as data URLs in the last user message.
Reasoning models (gpt-5*, o*) take no temperature: only their default is accepted.
"""

import base64
import re
import time
from typing import Any

import httpx

from backend.core.ai.base import BaseAIProvider
from backend.core.ai.retry import ProviderHTTPError, with_retry

API = "https://api.openai.com/v1"
_REASONING = re.compile(r"^(gpt-5|o\d)")
_CHAT_MODEL = re.compile(r"^(gpt-|o\d|chatgpt-)")
_NOT_CHAT = re.compile(r"(audio|realtime|transcribe|tts|image|search|embedding|moderation|instruct)")


class OpenAIProvider(BaseAIProvider):
    category = "openai"
    default_model = "gpt-5-mini"
    supported_models = ["gpt-5-mini", "gpt-5", "gpt-5-nano", "gpt-4.1", "gpt-4.1-mini", "gpt-4o"]
    can_see_images = True
    max_context_tokens = 400_000  # gpt-5; gpt-4.1 takes more, gpt-4o less (the server says when it is too much)
    default_context_tokens = 128_000

    def _complete(self, messages: list[dict[str, Any]], temperature: float, max_tokens: int = 16_000) -> str:
        payload: dict[str, Any] = {"model": self.model, "messages": messages, "max_completion_tokens": max_tokens}
        if not _REASONING.match(self.model):
            payload["temperature"] = temperature

        def call() -> str:
            with httpx.Client(timeout=httpx.Timeout(600.0, connect=15.0)) as client:
                resp = client.post(f"{API}/chat/completions", headers={"Authorization": f"Bearer {self.api_key}"}, json=payload)
                if resp.status_code >= 400:
                    raise ProviderHTTPError(resp.status_code, f"ChatGPT: {resp.text[:300]}")
                return resp.json()["choices"][0]["message"]["content"] or ""

        return with_retry(call, "ChatGPT")

    def generate_text(self, prompt: str, system: str = "", temperature: float = 0.2, **kwargs: Any) -> str:
        msgs = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
        return self._complete(msgs, temperature)

    def chat(self, messages: list[dict[str, str]], system: str = "", temperature: float = 0.2, **kwargs: Any) -> str:
        msgs: list[dict[str, Any]] = ([{"role": "system", "content": system}] if system else []) + [dict(m) for m in messages]
        images = kwargs.get("images") or []
        if images and msgs and msgs[-1]["role"] == "user":
            parts: list[dict[str, Any]] = [{"type": "text", "text": msgs[-1]["content"]}]
            parts += [{"type": "image_url", "image_url": {"url": f"data:{mime};base64,{base64.b64encode(data).decode()}"}} for data, mime in images]
            msgs[-1] = {"role": "user", "content": parts}
        return self._complete(msgs, temperature)


_models_cache: dict[str, tuple[float, list[str]]] = {}


def list_models(api_key: str) -> list[str]:
    """The account's chat models from /v1/models, newest first by name (cached for an hour per key); the defaults
    when it cannot be read."""
    cached = _models_cache.get(api_key)
    if cached and time.time() - cached[0] < 3600:
        return cached[1]
    models = _fetch_models(api_key)
    if models is not OpenAIProvider.supported_models:
        _models_cache[api_key] = (time.time(), models)
    return models


def _fetch_models(api_key: str) -> list[str]:
    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.get(f"{API}/models", headers={"Authorization": f"Bearer {api_key}"})
            resp.raise_for_status()
            ids = [m["id"] for m in resp.json().get("data", [])]
    except (httpx.HTTPError, ValueError, KeyError):
        return OpenAIProvider.supported_models
    chat = sorted((i for i in ids if _CHAT_MODEL.match(i) and not _NOT_CHAT.search(i)), reverse=True)
    return chat or OpenAIProvider.supported_models
