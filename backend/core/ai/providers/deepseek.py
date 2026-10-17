"""
DeepSeek provider (OpenAI-compatible chat completions). The reasoner model takes no temperature.
"""

from typing import Any

from backend.core.ai.providers.openai_compat import OpenAICompatibleProvider


class DeepSeekProvider(OpenAICompatibleProvider):
    category = "deepseek"
    default_model = "deepseek-chat"
    supported_models = ["deepseek-chat", "deepseek-reasoner", "deepseek-v4-flash", "deepseek-v4-pro"]
    max_context_tokens = 128_000
    default_context_tokens = 64_000
    url = "https://api.deepseek.com/chat/completions"
    label = "DeepSeek"

    def _payload(self, messages: list[dict[str, Any]], temperature: float) -> dict[str, Any]:
        payload: dict[str, Any] = {"model": self.model, "messages": messages, "max_tokens": 8000}
        if self.model != "deepseek-reasoner":
            payload["temperature"] = temperature
        return payload
