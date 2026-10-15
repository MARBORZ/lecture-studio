"""
Lesson (= NotebookLM source) schemas.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from backend.models.project import INBOX_ID
from backend.models.transcript import Segment

LessonStatus = Literal["in_progress", "to_review", "completed"]

BOOKMARK_LABEL_MAX = 20


class Bookmark(BaseModel):
    """A user's own mark on the clean timeline."""

    id: str = Field(min_length=1, max_length=32)
    t: float = Field(ge=0)
    label: str = Field(default="", max_length=BOOKMARK_LABEL_MAX)

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
    bookmarks: list[Bookmark] = Field(default_factory=list)


class TimeMapEntry(BaseModel):
    segment_index: int = 0
    orig_start: float
    orig_end: float
    clean_start: float
    clean_end: float


class LessonFull(Lesson):
    segments: list[Segment] = Field(default_factory=list)
    time_map: list[TimeMapEntry] = Field(default_factory=list)
    lesson_audit_md: str = ""
    plain_text: str = ""
    clean_timestamps_text: str = ""
    orig_timestamps_text: str = ""
    srt_text: str = ""
    audio_url: str | None = None
    video_url: str | None = None


class LessonPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    notes: str | None = None
    status: LessonStatus | None = None
    project_id: str | None = None
    tags: str | None = None
    bookmarks: list[Bookmark] | None = None  # the full list (replaces)


class ExportRequest(BaseModel):
    target_dir: str | None = None  # None -> settings.export_dir
    title: str | None = None


class ExportResult(BaseModel):
    target_dir: str
    title: str
    count: int
    files: list[str]
