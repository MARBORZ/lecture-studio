"""
Google Gemini provider (text). Audio transcription lives in core/transcription/gemini.py.
"""

from typing import Any, Dict, List

from backend.core.ai.base import BaseAIProvider


class GeminiProvider(BaseAIProvider):
    category = "gemini"
    default_model = "gemini-3.5-flash"
    supported_models = ["gemini-3.5-flash", "gemini-3.8-flash", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite"]
    can_transcribe_audio = True
    context_chars = 600_000

    def _generate(self, contents: list, system: str, temperature: float) -> str:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=self.api_key)
        config = types.GenerateContentConfig(temperature=temperature, system_instruction=system or None)
        return client.models.generate_content(model=self.model, contents=contents, config=config).text or ""

    def generate_text(self, prompt: str, system: str = "", temperature: float = 0.2, **kwargs: Any) -> str:
        return self._generate([prompt], system, temperature)

    def chat(self, messages: List[Dict[str, str]], system: str = "", temperature: float = 0.2, **kwargs: Any) -> str:
        from google.genai import types

        contents = [
            types.Content(role="model" if m["role"] == "assistant" else "user", parts=[types.Part(text=m["content"])])
            for m in messages
        ]
        return self._generate(contents, system, temperature)
