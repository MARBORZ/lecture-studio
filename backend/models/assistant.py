"""
NotebookLM-style assistant schemas.
"""

from datetime import datetime
from typing import List, Literal, Optional

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
ThreadKind = Literal["project", "lesson"]


class ChatMessage(BaseModel):
    id: str
    role: Literal["user", "assistant"]
    content: str
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat(timespec="seconds"))
    sources: List[str] = Field(default_factory=list)  # lesson ids
    attachments: List[Attachment] = Field(default_factory=list)
    assistant_role: AssistantRole = "qa"
    provider: Optional[str] = None
    model: Optional[str] = None


class AskRequest(BaseModel):
    question: str = ""
    role: AssistantRole = "qa"
    sources: Optional[List[str]] = None  # project threads: selected lesson ids (None = all)
    provider: Optional[AIProviderName] = None
    attachments: List[str] = Field(default_factory=list)  # attachment ids uploaded beforehand


class Thread(BaseModel):
    kind: ThreadKind
    id: str
    messages: List[ChatMessage] = Field(default_factory=list)
