"""
Base AI provider. Providers implement only transport (generate_text / chat);
the audit algorithm (chunking, prompts, post-processing) lives here once.
"""

import re
from abc import abstractmethod
from collections.abc import Callable, Iterator
from typing import Any

from backend.core.ai import prompts
from backend.core.ai.meta import AIMeta
from backend.core.timeline import normalize_timecodes
from backend.i18n import tr

CHUNK_CHARS = 30_000

# The assistant's context window is set in tokens (Settings → AI), per provider, within the model's limit. Our budget
# (services/context_window.py) counts characters: CHARS_PER_TOKEN is a deliberately low estimate for the mix we send
# (Russian prose, timecodes, code): about 3 characters per token, so the real token count stays under the setting.
CHARS_PER_TOKEN = 3
MIN_CONTEXT_TOKENS = 8_000
SEPARATOR = "\n\n---\n\n"

_EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF\U00002B00-\U00002BFF️‍]"
)


def strip_emoji(text: str) -> str:
    return re.sub(r"[ \t]{2,}", " ", _EMOJI_RE.sub("", text))


def clean_output(text: str, duration: float | None, timed: bool = True) -> str:
    text = strip_emoji(text).strip()
    text = re.sub(r"^```(?:markdown|md)?\s*\n(.*)\n```\s*$", r"\1", text, flags=re.S)  # unwrap fenced reply
    return normalize_timecodes(text, duration) if timed else text


def split_lines(text: str, limit: int = CHUNK_CHARS) -> list[str]:
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
    supported_models: list[str] = []
    can_transcribe_audio: bool = False
    max_context_tokens: int = 128_000  # the model's window: the setting cannot go above it
    default_context_tokens: int = 64_000  # the assistant's window until the user changes it
    needs_key: bool = True  # False: a local model, or the user's own signed-in Claude Code

    def __init__(self, api_key: str = "", model: str | None = None):
        if self.needs_key and not api_key:
            raise ValueError(tr("ai.no_key", provider=self.category))
        self.api_key = api_key
        self.model = model or self.default_model

    def generate_text(self, prompt: str, system: str = "", temperature: float = 0.2, **kwargs: Any) -> str:
        """Single-turn completion: a chat of one message."""
        return self.chat([{"role": "user", "content": prompt}], system, temperature, **kwargs)

    #: whether chat(images=...) is understood; providers without vision ignore images
    can_see_images: bool = False

    def audit_window_tokens(self) -> int | None:
        """The window an audit request must fit (a local model's small one); None = parts of CHUNK_CHARS fit."""
        return None

    def _part_limit(self, system: str) -> int:
        """Characters of material one request may carry next to `system`, leaving room for the answer."""
        window = self.audit_window_tokens()
        if not window:
            return CHUNK_CHARS
        answer = min(4096, max(1024, window // 4))  # tokens kept free for the reply
        room = int((window - answer) * CHARS_PER_TOKEN * 0.9) - len(system) - 500  # 10% margin: the estimate is rough
        return max(2000, min(CHUNK_CHARS, room))

    @abstractmethod
    def chat(self, messages: list[dict[str, str]], system: str = "", temperature: float = 0.2, **kwargs: Any) -> str:
        """Multi-turn completion; messages are {'role': 'user'|'assistant', 'content': str}.
        Optional kwarg images: list of (bytes, mime) attached to the last user message."""

    def stream_chat(self, messages: list[dict[str, str]], system: str = "", temperature: float = 0.2, **kwargs: Any) -> Iterator[str]:
        """The answer in pieces as the model writes it (the chat prints them). A transport without streaming gives
        the whole answer as one piece."""
        yield self.chat(messages, system, temperature, **kwargs)

    def generate_audit(
        self,
        transcript: str,
        duration: float | None,
        timed: bool = True,
        on_progress: Callable[[float, str], None] | None = None,
        language: str = "en",
    ) -> str:
        """Audit markdown from a compact '[MM:SS] text' transcript (clean timeline), written in `language`."""
        report = on_progress or (lambda f, m: None)
        if not transcript.strip():
            raise ValueError(tr("audit.empty"))

        systems = (prompts.audit_system(timed, language), prompts.chunk_notes_system(timed, language), prompts.merge_system(timed, language))
        limit = self._part_limit(max(systems, key=len))
        chunks = split_lines(transcript, limit)
        if len(chunks) == 1:
            report(0.1, tr("audit.start"))
            raw = self.generate_text(prompts.audit_prompt(transcript, timed), prompts.audit_system(timed, language))
            return clean_output(raw, duration, timed)

        notes = []
        for i, chunk in enumerate(chunks, start=1):
            report((i - 1) / (len(chunks) + 1), tr("audit.part", i=i, n=len(chunks)))
            notes.append(self.generate_text(
                prompts.chunk_notes_prompt(chunk, i, len(chunks)),
                prompts.chunk_notes_system(timed, language),
            ))
        report(len(chunks) / (len(chunks) + 1), tr("audit.merge"))
        raw = self.generate_text(self._fit_notes(notes, limit, prompts.merge_system(timed, language)), prompts.merge_system(timed, language))
        return clean_output(raw, duration, timed)

    def _fit_notes(self, notes: list[str], limit: int, merge_system: str) -> str:
        """The parts' notes joined for the final merge. When they do not fit the window (a small local model), groups of
        them are merged first, round after round, until they do."""
        joined = SEPARATOR.join(notes)
        while len(joined) > limit and len(notes) > 1:
            groups: list[list[str]] = [[]]
            for note in notes:
                if groups[-1] and len(SEPARATOR.join([*groups[-1], note])) > limit:
                    groups.append([])
                groups[-1].append(note)
            if all(len(g) == 1 for g in groups):  # every note alone is near the limit: pairs, each cut to fit
                half = limit // 2 - len(SEPARATOR)
                groups = [[n[:half] for n in notes[i : i + 2]] for i in range(0, len(notes), 2)]
            notes = [self.generate_text(SEPARATOR.join(g), merge_system) if len(g) > 1 else g[0] for g in groups]
            joined = SEPARATOR.join(notes)
        return joined[:limit]
