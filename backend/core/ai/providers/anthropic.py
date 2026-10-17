"""
Anthropic provider (Claude): the Messages API. The system prompt is its own field; images in the assistant go as
base64 blocks in the last user message. 529 (overloaded) is retried like 503.
"""

import base64
import json
from collections.abc import Iterator
from typing import Any

import httpx

from backend.core.ai.base import BaseAIProvider
from backend.core.ai.retry import ProviderHTTPError, stream_with_retry, with_retry

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"
TIMEOUT = httpx.Timeout(600.0, connect=15.0)


class AnthropicProvider(BaseAIProvider):
    category = "anthropic"
    default_model = "claude-sonnet-5-5"
    supported_models = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"]
    can_see_images = True
    max_context_tokens = 1_000_000  # the largest Claude window; most models take 200k (the server says when it is too much)
    default_context_tokens = 200_000

    def _payload(self, messages: list[dict[str, str]], system: str, temperature: float, images: list) -> dict[str, Any]:
        msgs: list[dict[str, Any]] = [dict(m) for m in messages]
        if images and msgs and msgs[-1]["role"] == "user":
            blocks: list[dict[str, Any]] = [
                {"type": "image", "source": {"type": "base64", "media_type": mime, "data": base64.b64encode(data).decode()}} for data, mime in images
            ]
            msgs[-1] = {"role": "user", "content": [*blocks, {"type": "text", "text": msgs[-1]["content"]}]}
        payload: dict[str, Any] = {"model": self.model, "max_tokens": 16_000, "messages": msgs, "temperature": temperature}
        if system:
            payload["system"] = system
        return payload

    def _headers(self) -> dict[str, str]:
        return {"x-api-key": self.api_key, "anthropic-version": API_VERSION, "content-type": "application/json"}

    @staticmethod
    def _check(resp: httpx.Response) -> None:
        if resp.status_code >= 400:
            resp.read()
            raise ProviderHTTPError(resp.status_code, f"Claude: {resp.text[:300]}")

    def chat(self, messages: list[dict[str, str]], system: str = "", temperature: float = 0.2, **kwargs: Any) -> str:
        payload = self._payload(messages, system, temperature, kwargs.get("images") or [])

        def call() -> str:
            with httpx.Client(timeout=TIMEOUT) as client:
                resp = client.post(API_URL, headers=self._headers(), json=payload)
                self._check(resp)
                return "".join(block.get("text", "") for block in resp.json().get("content", []) if block.get("type") == "text")

        return with_retry(call, "Claude")

    def stream_chat(self, messages: list[dict[str, str]], system: str = "", temperature: float = 0.2, **kwargs: Any) -> Iterator[str]:
        payload = {**self._payload(messages, system, temperature, kwargs.get("images") or []), "stream": True}

        def make() -> Iterator[str]:
            with httpx.Client(timeout=TIMEOUT) as client, client.stream("POST", API_URL, headers=self._headers(), json=payload) as resp:
                self._check(resp)
                for line in resp.iter_lines():  # server-sent events: text arrives in content_block_delta
                    if not line.startswith("data:"):
                        continue
                    try:
                        event = json.loads(line[5:])
                    except ValueError:
                        continue
                    if event.get("type") == "error":
                        raise ProviderHTTPError(529 if "overloaded" in json.dumps(event) else 500, f"Claude: {json.dumps(event)[:300]}")
                    delta = event.get("delta") or {}
                    if event.get("type") == "content_block_delta" and delta.get("type") == "text_delta" and delta.get("text"):
                        yield delta["text"]

        return stream_with_retry(make, "Claude")
