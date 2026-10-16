"""
Anthropic provider (Claude): the Messages API. The system prompt is its own field; images in the assistant go as
base64 blocks in the last user message. 529 (overloaded) is retried like 503.
"""

import base64
from typing import Any

import httpx

from backend.core.ai.base import BaseAIProvider
from backend.core.ai.retry import ProviderHTTPError, with_retry

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"


class AnthropicProvider(BaseAIProvider):
    category = "anthropic"
    default_model = "claude-sonnet-5-5"
    supported_models = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"]
    can_see_images = True
    max_context_tokens = 1_000_000  # the largest Claude window; most models take 200k (the server says when it is too much)
    default_context_tokens = 200_000

    def _complete(self, messages: list[dict[str, Any]], system: str, temperature: float, max_tokens: int = 16_000) -> str:
        payload: dict[str, Any] = {"model": self.model, "max_tokens": max_tokens, "messages": messages, "temperature": temperature}
        if system:
            payload["system"] = system
        headers = {"x-api-key": self.api_key, "anthropic-version": API_VERSION, "content-type": "application/json"}

        def call() -> str:
            with httpx.Client(timeout=httpx.Timeout(600.0, connect=15.0)) as client:
                resp = client.post(API_URL, headers=headers, json=payload)
                if resp.status_code >= 400:
                    raise ProviderHTTPError(resp.status_code, f"Claude: {resp.text[:300]}")
                return "".join(block.get("text", "") for block in resp.json().get("content", []) if block.get("type") == "text")

        return with_retry(call, "Claude")

    def generate_text(self, prompt: str, system: str = "", temperature: float = 0.2, **kwargs: Any) -> str:
        return self._complete([{"role": "user", "content": prompt}], system, temperature)

    def chat(self, messages: list[dict[str, str]], system: str = "", temperature: float = 0.2, **kwargs: Any) -> str:
        msgs: list[dict[str, Any]] = [dict(m) for m in messages]
        images = kwargs.get("images") or []
        if images and msgs and msgs[-1]["role"] == "user":
            blocks: list[dict[str, Any]] = [
                {"type": "image", "source": {"type": "base64", "media_type": mime, "data": base64.b64encode(data).decode()}} for data, mime in images
            ]
            msgs[-1] = {"role": "user", "content": [*blocks, {"type": "text", "text": msgs[-1]["content"]}]}
        return self._complete(msgs, system, temperature)
