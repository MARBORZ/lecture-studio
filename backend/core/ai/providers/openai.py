"""
OpenAI provider (ChatGPT): Chat Completions. Images in the assistant go as data URLs in the last user message.
Reasoning models (gpt-5*, o*) take no temperature: only their default is accepted.
"""

import base64
import re
import time
from typing import Any

import httpx

from backend.core.ai.providers.openai_compat import OpenAICompatibleProvider

API = "https://api.openai.com/v1"
_REASONING = re.compile(r"^(gpt-5|o\d)")
_CHAT_MODEL = re.compile(r"^(gpt-|o\d|chatgpt-)")
_NOT_CHAT = re.compile(r"(audio|realtime|transcribe|tts|image|search|embedding|moderation|instruct)")


class OpenAIProvider(OpenAICompatibleProvider):
    category = "openai"
    default_model = "gpt-5-mini"
    supported_models = ["gpt-5-mini", "gpt-5", "gpt-5-nano", "gpt-4.1", "gpt-4.1-mini", "gpt-4o"]
    can_see_images = True
    max_context_tokens = 400_000  # gpt-5; gpt-4.1 takes more, gpt-4o less (the server says when it is too much)
    default_context_tokens = 128_000
    url = f"{API}/chat/completions"
    label = "ChatGPT"

    def _payload(self, messages: list[dict[str, Any]], temperature: float) -> dict[str, Any]:
        payload: dict[str, Any] = {"model": self.model, "messages": messages, "max_completion_tokens": 16_000}
        if not _REASONING.match(self.model):
            payload["temperature"] = temperature
        return payload

    def _messages(self, messages: list[dict[str, str]], system: str, images: list) -> list[dict[str, Any]]:
        msgs = super()._messages(messages, system, images)
        if images and msgs and msgs[-1]["role"] == "user":
            parts: list[dict[str, Any]] = [{"type": "text", "text": msgs[-1]["content"]}]
            parts += [{"type": "image_url", "image_url": {"url": f"data:{mime};base64,{base64.b64encode(data).decode()}"}} for data, mime in images]
            msgs[-1] = {"role": "user", "content": parts}
        return msgs


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
