"""
Processing job schemas.
"""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from backend.models.project import INBOX_ID
from backend.settings.schema import PipelineDefaults

JobStatus = Literal["pending", "processing", "completed", "error", "cancelled"]
JobKind = Literal["process", "audit", "download"]
Stage = Literal["queued", "download", "extract", "vad", "audio", "video", "transcribe", "audit", "save", "done"]

ACTIVE_STATUSES = ("pending", "processing")


class JobOptions(PipelineDefaults):
    """Per-job options: pipeline defaults + source metadata."""

    lesson_title: str = ""
    project_id: str = INBOX_ID
    notes: str = ""
    local_path: str | None = None
    export_after: bool = False


class JobStats(BaseModel):
    orig_duration_sec: float = 0.0
    clean_duration_sec: float = 0.0
    saved_percent: float = 0.0
    speech_segments_count: int = 0
    has_video: bool = False
    fps: float = 0.0
    orig_video_size_mb: float = 0.0
    clean_video_size_mb: float = 0.0
    video_saved_percent: float = 0.0
    video_encoder: str = ""  # x264 | nvenc
    av_drift_sec: float = 0.0


class Job(BaseModel):
    id: str
    kind: JobKind = "process"
    title: str = ""
    status: JobStatus = "pending"
    stage: Stage = "queued"
    stages: list[Stage] = Field(default_factory=list)
    progress: int = 0
    message: str = ""
    error: str | None = None
    warning: str | None = None
    stats: JobStats | None = None
    lesson_id: str | None = None
    media_path: str | None = None  # a download: the saved file, for the Studio
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat(timespec="seconds"))
    finished_at: str | None = None
    cancel_requested: bool = False

    @property
    def active(self) -> bool:
        return self.status in ACTIVE_STATUSES


class JobStarted(BaseModel):
    job: Job


class JobEvent(BaseModel):
    """SSE payload."""

    job: Job
    extra: dict[str, Any] = Field(default_factory=dict)
