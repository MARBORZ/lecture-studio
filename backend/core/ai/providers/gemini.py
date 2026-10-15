"""
Google Gemini provider (text). Audio transcription lives in core/transcription/gemini.py.
"""

from typing import Any

from backend.core.ai.base import BaseAIProvider
from backend.core.ai.retry import with_retry


class GeminiProvider(BaseAIProvider):
    category = "gemini"
    default_model = "gemini-3.5-flash"
    supported_models = ["gemini-3.5-flash", "gemini-3.8-flash", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite"]
    can_transcribe_audio = True
    can_see_images = True
    context_chars = 600_000

    def _generate(self, contents: list, system: str, temperature: float) -> str:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=self.api_key)
        config = types.GenerateContentConfig(temperature=temperature, system_instruction=system or None)
        return with_retry(lambda: client.models.generate_content(model=self.model, contents=contents, config=config).text or "", "Gemini")

    def generate_text(self, prompt: str, system: str = "", temperature: float = 0.2, **kwargs: Any) -> str:
        return self._generate([prompt], system, temperature)

    def chat(self, messages: list[dict[str, str]], system: str = "", temperature: float = 0.2, **kwargs: Any) -> str:
        from google.genai import types

        contents = [
            types.Content(role="model" if m["role"] == "assistant" else "user", parts=[types.Part(text=m["content"])])
            for m in messages
        ]
        images = kwargs.get("images") or []
        if images and contents:
            contents[-1].parts.extend(types.Part.from_bytes(data=data, mime_type=mime) for data, mime in images)
        return self._generate(contents, system, temperature)
