"""
Chat Completions transport shared by the providers that speak OpenAI's protocol (DeepSeek, ChatGPT, and a local
server's /v1). Subclasses give the address and their few differences: the payload (token limit name, which models
take a temperature) and the messages (images). The answer comes whole (chat) or as server-sent events (stream_chat).
"""

import json
from collections.abc import Iterable, Iterator
from typing import Any

import httpx

from backend.core.ai.base import BaseAIProvider
from backend.core.ai.retry import ProviderHTTPError, stream_with_retry, with_retry

TIMEOUT = httpx.Timeout(600.0, connect=15.0)


def sse_deltas(lines: Iterable[str]) -> Iterator[str]:
    """Text pieces of a streamed Chat Completions response (`data: {...}` lines, `data: [DONE]` at the end)."""
    for line in lines:
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            return
        try:
            choices = json.loads(data).get("choices") or [{}]
        except ValueError:
            continue
        piece = (choices[0].get("delta") or {}).get("content")
        if piece:
            yield piece


class OpenAICompatibleProvider(BaseAIProvider):
    url: str = ""  # .../chat/completions
    label: str = ""  # the name in errors

    def _payload(self, messages: list[dict[str, Any]], temperature: float) -> dict[str, Any]:
        return {"model": self.model, "messages": messages, "temperature": temperature}

    def _messages(self, messages: list[dict[str, str]], system: str, images: list) -> list[dict[str, Any]]:
        return ([{"role": "system", "content": system}] if system else []) + [dict(m) for m in messages]

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"}

    def _check(self, resp: httpx.Response) -> None:
        if resp.status_code >= 400:
            resp.read()  # a streamed response has no body until read
            raise ProviderHTTPError(resp.status_code, f"{self.label}: {resp.text[:300]}")

    def chat(self, messages: list[dict[str, str]], system: str = "", temperature: float = 0.2, **kwargs: Any) -> str:
        payload = self._payload(self._messages(messages, system, kwargs.get("images") or []), temperature)

        def call() -> str:
            with httpx.Client(timeout=TIMEOUT) as client:
                resp = client.post(self.url, headers=self._headers(), json=payload)
                self._check(resp)
                return resp.json()["choices"][0]["message"]["content"] or ""

        return with_retry(call, self.label)

    def stream_chat(self, messages: list[dict[str, str]], system: str = "", temperature: float = 0.2, **kwargs: Any) -> Iterator[str]:
        payload = {**self._payload(self._messages(messages, system, kwargs.get("images") or []), temperature), "stream": True}

        def make() -> Iterator[str]:
            with httpx.Client(timeout=TIMEOUT) as client, client.stream("POST", self.url, headers=self._headers(), json=payload) as resp:
                self._check(resp)
                yield from sse_deltas(resp.iter_lines())

        return stream_with_retry(make, self.label)
