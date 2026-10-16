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
    released_at: str | None = None  # ISO date of the latest release; display only, the version number decides
    current_released_at: str | None = None  # ISO date of the running release (its tag), when known
    current_prerelease: bool = False  # a beta runs: beta updates come regardless of the setting
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


class UninstallPlan(BaseModel):
    """What "Delete Lecture Studio" removes. Lessons stay unless asked for; blocked = it cannot run as is."""

    app_dir: str  # code, .venv, node_modules
    settings_dir: str  # settings.json (API keys), logs, launcher state, app window profile
    data_dir: str  # lessons, diary, chats: kept by default
    lessons_inside: bool = False  # the library lives inside a folder that goes: keeping it is impossible
    blocked: Literal["git_work"] | None = None  # the app folder holds git work that is not on GitHub
    git_files: list[str] = []  # blocked == "git_work": what would be lost
    reinstall: Literal["git", "setup"]  # how to get it back: git clone + Setup, or the Setup app
    repo_url: str  # what to clone for reinstall == "git"


class UninstallRequest(BaseModel):
    delete_lessons: bool = False


class UninstallResult(BaseModel):
    ok: bool
    kept: str | None = None  # the lessons folder that stays
