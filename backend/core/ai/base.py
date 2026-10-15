"""
Base AI provider. Providers implement only transport (generate_text / chat);
the audit algorithm (chunking, prompts, post-processing) lives here once.
"""

import re
from abc import abstractmethod
from typing import Any, Callable, Dict, List, Optional

from backend.core.ai import prompts
from backend.core.ai.meta import AIMeta
from backend.core.timeline import normalize_timecodes

CHUNK_CHARS = 30_000

_EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF\U00002B00-\U00002BFF️‍]"
)


def strip_emoji(text: str) -> str:
    return re.sub(r"[ \t]{2,}", " ", _EMOJI_RE.sub("", text))


def clean_output(text: str, duration: Optional[float], timed: bool = True) -> str:
    text = strip_emoji(text).strip()
    text = re.sub(r"^```(?:markdown|md)?\s*\n(.*)\n```\s*$", r"\1", text, flags=re.S)  # unwrap fenced reply
    return normalize_timecodes(text, duration) if timed else text


def split_lines(text: str, limit: int = CHUNK_CHARS) -> List[str]:
    """Split on line boundaries into chunks of at most ~limit chars."""
    chunks, buf, size = [], [], 0
    for line in text.splitlines():
        if buf and size + len(line) > limit:
            chunks.append("\n".join(buf))
            buf, size = [], 0
        buf.append(line)
        size += len(line) + 1
    if buf:
        chunks.append("\n".join(buf))
    return chunks


class BaseAIProvider(metaclass=AIMeta):
    category: str = "base"
    default_model: str = ""
    supported_models: List[str] = []
    can_transcribe_audio: bool = False
    context_chars: int = 90_000  # safe source budget for one request (chars, not tokens)

    def __init__(self, api_key: str, model: Optional[str] = None):
        if not api_key:
            raise ValueError(f"Не задан API-ключ {self.category}. Укажите его в Настройках → ИИ.")
        self.api_key = api_key
        self.model = model or self.default_model

    @abstractmethod
    def generate_text(self, prompt: str, system: str = "", temperature: float = 0.2, **kwargs: Any) -> str:
        """Single-turn completion."""

    #: whether chat(images=...) is understood; providers without vision ignore images
    can_see_images: bool = False

    @abstractmethod
    def chat(self, messages: List[Dict[str, str]], system: str = "", temperature: float = 0.2, **kwargs: Any) -> str:
        """Multi-turn completion; messages are {'role': 'user'|'assistant', 'content': str}.
        Optional kwarg images: list of (bytes, mime) attached to the last user message."""

    def generate_audit(
        self,
        transcript: str,
        duration: Optional[float],
        timed: bool = True,
        on_progress: Optional[Callable[[float, str], None]] = None,
    ) -> str:
        """Audit markdown from a compact '[MM:SS] text' transcript (clean timeline)."""
        report = on_progress or (lambda f, m: None)
        if not transcript.strip():
            raise ValueError("Стенограмма пуста — аудит невозможен")

        chunks = split_lines(transcript)
        if len(chunks) == 1:
            report(0.1, "Аудит")
            raw = self.generate_text(prompts.audit_prompt(transcript, timed), prompts.audit_system(timed))
            return clean_output(raw, duration, timed)

        notes = []
        for i, chunk in enumerate(chunks, start=1):
            report((i - 1) / (len(chunks) + 1), f"Аудит: часть {i}/{len(chunks)}")
            notes.append(self.generate_text(
                prompts.chunk_notes_prompt(chunk, i, len(chunks)),
                prompts.chunk_notes_system(timed),
            ))
        report(len(chunks) / (len(chunks) + 1), "Аудит: сборка")
        raw = self.generate_text("\n\n---\n\n".join(notes), prompts.merge_system(timed))
        return clean_output(raw, duration, timed)
