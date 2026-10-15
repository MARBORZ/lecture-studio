"""
DeepSeek provider (OpenAI-compatible chat completions).
"""

from typing import Any

import httpx

from backend.core.ai.base import BaseAIProvider

API_URL = "https://api.deepseek.com/chat/completions"


class DeepSeekProvider(BaseAIProvider):
    category = "deepseek"
    default_model = "deepseek-chat"
    supported_models = ["deepseek-chat", "deepseek-reasoner", "deepseek-v4-flash", "deepseek-v4-pro"]

    def _complete(self, messages: list[dict[str, str]], temperature: float, max_tokens: int = 8000) -> str:
        payload: dict[str, Any] = {"model": self.model, "messages": messages, "max_tokens": max_tokens}
        if self.model != "deepseek-reasoner":
            payload["temperature"] = temperature
        with httpx.Client(timeout=httpx.Timeout(600.0, connect=15.0)) as client:
            resp = client.post(API_URL, headers={"Authorization": f"Bearer {self.api_key}"}, json=payload)
            if resp.status_code >= 400:
                raise RuntimeError(f"DeepSeek {resp.status_code}: {resp.text[:300]}")
            return resp.json()["choices"][0]["message"]["content"] or ""

    def generate_text(self, prompt: str, system: str = "", temperature: float = 0.2, **kwargs: Any) -> str:
        msgs = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
        return self._complete(msgs, temperature)

    def chat(self, messages: list[dict[str, str]], system: str = "", temperature: float = 0.2, **kwargs: Any) -> str:
        msgs = ([{"role": "system", "content": system}] if system else []) + messages
        return self._complete(msgs, temperature)
