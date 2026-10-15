"""
Processing job schemas.
"""

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from backend.models.project import INBOX_ID
from backend.settings.schema import PipelineDefaults

JobStatus = Literal["pending", "processing", "completed", "error", "cancelled"]
JobKind = Literal["process", "audit"]
Stage = Literal["queued", "extract", "vad", "audio", "video", "transcribe", "audit", "save", "done"]

ACTIVE_STATUSES = ("pending", "processing")


class JobOptions(PipelineDefaults):
    """Per-job options: pipeline defaults + source metadata."""

    lesson_title: str = ""
    project_id: str = INBOX_ID
    notes: str = ""
    local_path: Optional[str] = None
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
    av_drift_sec: float = 0.0


class Job(BaseModel):
    id: str
    kind: JobKind = "process"
    title: str = ""
    status: JobStatus = "pending"
    stage: Stage = "queued"
    stages: List[Stage] = Field(default_factory=list)
    progress: int = 0
    message: str = ""
    error: Optional[str] = None
    warning: Optional[str] = None
    stats: Optional[JobStats] = None
    lesson_id: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat(timespec="seconds"))
    finished_at: Optional[str] = None
    cancel_requested: bool = False

    @property
    def active(self) -> bool:
        return self.status in ACTIVE_STATUSES


class JobStarted(BaseModel):
    job: Job


class JobEvent(BaseModel):
    """SSE payload."""

    job: Job
    extra: Dict[str, Any] = Field(default_factory=dict)
