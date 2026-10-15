"""
System status / shutdown schemas.
"""

from typing import Literal

from pydantic import BaseModel


class BusyReason(BaseModel):
    kind: str  # "job" | "upload" | "export"
    label: str
    progress: int | None = None


class SystemStatus(BaseModel):
    busy: bool
    reasons: list[BusyReason]
    pid: int
    version: str
    ffmpeg: bool


class ShutdownResult(BaseModel):
    ok: bool


UpdateBlock = Literal["dirty", "diverged", "zip", "platform"]


class UpdateOutcome(BaseModel):
    """Result of the last update attempt. Reported for a few minutes after the restart; the UI shows it once (by `at`)."""

    from_version: str
    to_version: str
    ok: bool  # False = the new version did not start and the launcher rolled back
    at: float


class UpdateInfo(BaseModel):
    current: str
    latest: str | None = None
    available: bool = False
    mode: Literal["git", "zip"]
    changes: list[str] = []
    blocked: UpdateBlock | None = None  # why it cannot be applied from the app
    dirty_files: list[str] = []  # blocked == "dirty": the changed tracked files
    error: str | None = None  # the check itself failed (offline, git missing)
    checked_at: float | None = None
    url: str
    last: UpdateOutcome | None = None
    restart_failed: bool = False  # the code is updated but the launcher never started: the user has to start the app
