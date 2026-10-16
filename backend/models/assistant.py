"""
NotebookLM-style assistant schemas.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from backend.settings.schema import AIProviderName

AssistantRole = Literal["qa", "key_moments", "quiz", "pitfalls", "code_summary", "chapters"]
AttachmentKind = Literal["text", "document", "image", "binary"]


class Attachment(BaseModel):
    """A file attached to a chat message. `chars` = extracted text length; `note` explains limits."""

    id: str
    name: str
    size: int
    mime: str
    kind: AttachmentKind
    chars: int = 0
    note: str = ""
    session: str = ""  # the session whose local_session_src/ holds it; "" = an upload not yet in a session
ThreadKind = Literal["project", "lesson"]


class ChatMessage(BaseModel):
    id: str
    role: Literal["user", "assistant"]
    content: str
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat(timespec="seconds"))
    sources: list[str] = Field(default_factory=list)  # lesson ids
    attachments: list[Attachment] = Field(default_factory=list)
    assistant_role: AssistantRole = "qa"
    provider: str | None = None
    model: str | None = None


class AskRequest(BaseModel):
    question: str = ""
    role: AssistantRole = "qa"
    sources: list[str] | None = None  # project threads: selected lesson ids (None = all)
    provider: AIProviderName | None = None
    attachments: list[str] = Field(default_factory=list)  # attachment ids uploaded beforehand (this message)
    session_id: str | None = None  # None = the active session (created if there is none)


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


class ChatSession(BaseModel):
    """One branch of a thread (a session): its own history, summary and files."""

    id: str
    title: str = ""
    created_at: str = Field(default_factory=_now)
    updated_at: str = Field(default_factory=_now)
    messages: list[ChatMessage] = Field(default_factory=list)
    summary: str = ""  # compressed text of the first `summarized` messages
    summarized: int = 0  # leading messages folded into the summary (kept for display, not sent verbatim)


class SessionInfo(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str
    messages: int


class SessionPatch(BaseModel):
    title: str | None = Field(default=None, max_length=80)


class ContextUsage(BaseModel):
    """What one request carries, in characters, against the provider's window (our own context window).
    The tokens are what the user sets and sees: window_tokens is the setting, total_tokens the estimate of total."""

    provider: str
    window: int
    window_tokens: int = 0
    total_tokens: int = 0
    chars_per_token: int = 3  # the estimate behind total_tokens (core/ai/base.py: CHARS_PER_TOKEN)
    system: int = 0
    sources: int = 0
    summary: int = 0
    history: int = 0
    files: int = 0
    total: int = 0
    summarized: int = 0  # messages folded into the summary
    sources_trimmed: bool = False  # sources were cut to fit the window
    sources_count: int = 0  # lessons in the request
    sources_whole: int = 0  # of them, how many went in whole
    sources_share: float = 1.0  # share of the material (characters) that fit, 0..1


class CompactRequest(BaseModel):
    provider: AIProviderName | None = None
    sources: list[str] | None = None


class Thread(BaseModel):
    kind: ThreadKind
    id: str
    session: ChatSession  # the active (or requested) session
    sessions: list[SessionInfo] = Field(default_factory=list)  # newest first
    files: list[Attachment] = Field(default_factory=list)  # files kept in the session: offered to attach again
    context: ContextUsage | None = None
