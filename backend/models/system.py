"""
System status / shutdown schemas.
"""

from typing import List

from pydantic import BaseModel


class BusyReason(BaseModel):
    kind: str  # "job" | "upload" | "export"
    label: str
    progress: int | None = None


class SystemStatus(BaseModel):
    busy: bool
    reasons: List[BusyReason]
    pid: int
    version: str
    ffmpeg: bool


class ShutdownResult(BaseModel):
    ok: bool
