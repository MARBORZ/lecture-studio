"""
Lesson (= NotebookLM source) schemas.
"""

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from backend.models.project import INBOX_ID
from backend.models.transcript import Segment

LessonStatus = Literal["in_progress", "to_review", "completed"]

SCHEMA_VERSION = 3  # internal lesson-data format number, not the app version


class Lesson(BaseModel):
    id: str
    job_id: str
    project_id: str = INBOX_ID
    title: str = "Урок"
    notes: str = ""
    status: LessonStatus = "in_progress"
    tags: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat(timespec="seconds"))
    orig_duration_sec: float = 0.0
    clean_duration_sec: float = 0.0
    saved_percent: float = 0.0
    has_transcription: bool = False
    has_audit: bool = False
    has_video: bool = False
    schema_version: int = 0


class TimeMapEntry(BaseModel):
    segment_index: int = 0
    orig_start: float
    orig_end: float
    clean_start: float
    clean_end: float


class LessonFull(Lesson):
    segments: List[Segment] = Field(default_factory=list)
    time_map: List[TimeMapEntry] = Field(default_factory=list)
    lesson_audit_md: str = ""
    plain_text: str = ""
    clean_timestamps_text: str = ""
    orig_timestamps_text: str = ""
    srt_text: str = ""
    audio_url: Optional[str] = None
    video_url: Optional[str] = None


class LessonPatch(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    notes: Optional[str] = None
    status: Optional[LessonStatus] = None
    project_id: Optional[str] = None
    tags: Optional[str] = None


class ExportRequest(BaseModel):
    target_dir: Optional[str] = None  # None -> settings.export_dir
    title: Optional[str] = None


class ExportResult(BaseModel):
    target_dir: str
    title: str
    count: int
    files: List[str]
