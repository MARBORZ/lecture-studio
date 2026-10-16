"""Bug reports and ideas sent from the app (services/feedback.py)."""

from typing import Literal

from pydantic import BaseModel, Field

FeedbackKind = Literal["bug", "idea", "other"]


class FeedbackLimits(BaseModel):
    """The same numbers the server enforces; the form shows them and checks before uploading."""

    max_files: int
    max_file_bytes: int
    max_total_bytes: int
    min_message: int
    max_message: int
    max_contact: int
    cooldown_sec: int
    daily_limit: int
    extensions: list[str]


class FeedbackDraft(BaseModel):
    id: str
    limits: FeedbackLimits
    retry_after: int = 0  # seconds until another report may be sent (cooldown / daily limit), 0 = now


class FeedbackFile(BaseModel):
    name: str
    size: int


class FeedbackSend(BaseModel):
    kind: FeedbackKind = "bug"
    message: str = Field(max_length=20_000)
    contact: str = Field("", max_length=1000)
    diagnostics: bool = True  # version, OS, compute, log tails (secrets masked)
    website: str = ""  # honeypot: hidden in the form, a person never fills it


class FeedbackResult(BaseModel):
    status: Literal["sent", "queued"]  # queued: kept on this computer, sent when the relay is reachable
    outbox: int = 0  # reports still waiting
