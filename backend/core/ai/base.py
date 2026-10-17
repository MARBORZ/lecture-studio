"""
Base AI provider: transport only — chat, stream_chat, and the window an audit request must fit. The audit algorithm is
core/ai/audit.py, cleaning a model's text core/ai/output.py.
"""

from abc import abstractmethod
from collections.abc import Iterator
from typing import Any

from backend.core.ai.meta import AIMeta
from backend.i18n import tr

# The assistant's context window is set in tokens (Settings → AI), per provider, within the model's limit. Our budget
# (services/context_window.py) counts characters: CHARS_PER_TOKEN is a deliberately low estimate for the mix we send
# (Russian prose, timecodes, code): about 3 characters per token, so the real token count stays under the setting.
CHARS_PER_TOKEN = 3
MIN_CONTEXT_TOKENS = 8_000


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

    @abstractmethod
    def chat(self, messages: list[dict[str, str]], system: str = "", temperature: float = 0.2, **kwargs: Any) -> str:
        """Multi-turn completion; messages are {'role': 'user'|'assistant', 'content': str}.
        Optional kwarg images: list of (bytes, mime) attached to the last user message."""

    def stream_chat(self, messages: list[dict[str, str]], system: str = "", temperature: float = 0.2, **kwargs: Any) -> Iterator[str]:
        """The answer in pieces as the model writes it (the chat prints them). A transport without streaming gives
        the whole answer as one piece."""
        yield self.chat(messages, system, temperature, **kwargs)
