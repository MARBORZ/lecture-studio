"""
Health, status, graceful shutdown, self-update and uninstall.
"""

import os
import threading

from fastapi import APIRouter, HTTPException

from backend.config import APP_VERSION, CHROME_PROFILE_DIR, FRONTEND_PID_FILE, FRONTEND_PORT
from backend.core.media import ffmpeg_available
from backend.models.system import ShutdownResult, SystemStatus, UninstallPlan, UninstallRequest, UninstallResult, UpdateInfo
from backend.services import uninstall, updates
from backend.services.jobs import JobRegistry
from backend.utils import proc
from backend.utils.fs import read_text, remove_file

router = APIRouter(prefix="/api", tags=["system"])

# Shutdown, update and uninstall all take the server down: one lock, one busy check.
_shutdown_lock = threading.Lock()


@router.get("/health")
def health() -> dict:
    return {"ok": True, "version": APP_VERSION}


@router.get("/system/status", response_model=SystemStatus)
def status() -> SystemStatus:
    reasons = JobRegistry.busy_reasons()
    return SystemStatus(busy=bool(reasons), reasons=reasons, pid=os.getpid(), version=APP_VERSION, ffmpeg=ffmpeg_available())


@router.post("/system/shutdown", response_model=ShutdownResult)
def shutdown() -> ShutdownResult:
    """Stop the server if (and only if) nothing is running. The check and the trigger are atomic."""
    with _shutdown_lock:
        reasons = JobRegistry.busy_reasons()
        if reasons:
            raise HTTPException(409, detail={"message": "Система занята", "reasons": [r.model_dump() for r in reasons]})
        threading.Timer(1.2, _stop_everything).start()
    return ShutdownResult(ok=True)


@router.get("/system/update", response_model=UpdateInfo)
def update_info(force: bool = False) -> UpdateInfo:
    """Newest release vs the running version. Cached for an hour; force=true fetches now."""
    return updates.check(force)


@router.post("/system/update", response_model=UpdateInfo)
def update_apply() -> UpdateInfo:
    """Move the code to the newest release and restart through the launcher. Refused while busy."""
    with _shutdown_lock:
        reasons = JobRegistry.busy_reasons()
        if reasons:
            raise HTTPException(409, detail={"message": "Система занята", "reasons": [r.model_dump() for r in reasons]})
        try:
            return updates.apply()
        except updates.UpdateError as e:
            raise HTTPException(409, detail={"message": str(e), "code": e.code}) from e


@router.post("/system/update/discard", response_model=UpdateInfo)
def update_discard() -> UpdateInfo:
    """Put the modified tracked files that block the update back to the committed version; returns a fresh check."""
    with _shutdown_lock:
        try:
            return updates.discard_changes()
        except updates.UpdateError as e:
            raise HTTPException(409, detail={"message": str(e), "code": e.code}) from e


@router.get("/system/uninstall", response_model=UninstallPlan)
def uninstall_preview() -> UninstallPlan:
    """What "Delete Lecture Studio" would remove, and whether it can run."""
    return uninstall.preview()


@router.post("/system/uninstall", response_model=UninstallResult)
def uninstall_start(req: UninstallRequest) -> UninstallResult:
    """Start the OS uninstaller detached, then stop everything: it waits for this server to exit and deletes the app."""
    with _shutdown_lock:
        reasons = JobRegistry.busy_reasons()
        if reasons:
            raise HTTPException(409, detail={"message": "Система занята", "reasons": [r.model_dump() for r in reasons]})
        try:
            plan = uninstall.start(req.delete_lessons)
        except uninstall.UninstallError as e:
            raise HTTPException(409, detail={"message": str(e), "code": e.code}) from e
        threading.Timer(1.2, _stop_everything).start()
    return UninstallResult(ok=True, kept=None if req.delete_lessons else plan.data_dir)


def _stop_everything() -> None:
    """Stop all local parts: app window (dedicated browser profile only), Vite UI server, then this API server."""
    proc.terminate(proc.pids_with_cmdline(f"--user-data-dir={CHROME_PROFILE_DIR}"))
    ui = {int(p) for p in read_text(FRONTEND_PID_FILE).split() if p.isdigit()} | proc.pids_listening(FRONTEND_PORT)
    proc.terminate(ui)
    remove_file(FRONTEND_PID_FILE)
    proc.stop_self()
