"""
FastAPI application factory. Pure JSON API on :3000; the UI is served by Vite on :5173.
"""

import logging
import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse

from backend.api.guard import LOCAL_HOSTS, LocalOriginWrites
from backend.api.routes import assistant, diary, feedback, jobs, lessons, projects, settings, system
from backend.config import APP_NAME, APP_VERSION, FRONTEND_ORIGINS, PID_FILE
from backend.core.media import ffmpeg_available
from backend.services import updates
from backend.services.jobs import QueueFull
from backend.services.migration import migrate_all
from backend.services.storage import Library
from backend.settings import paths
from backend.utils import proc
from backend.utils.fs import clear_dir, read_text, remove_file, write_text

logger = logging.getLogger(__name__)


def _other_live_server() -> int | None:
    """PID of another running Lecture Studio server on this machine (from the pid file), if any."""
    pid = read_text(PID_FILE).strip()
    if pid.isdigit() and int(pid) != os.getpid() and proc.pid_alive(int(pid)):
        return int(pid)
    return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    data = paths().ensure()
    # A second instance (dev server next to the running app) must not wipe the first one's temp/pid.
    owner = _other_live_server() is None
    if owner:
        freed = clear_dir(data.temp)
        if freed:
            logger.info("Temp cleared: %.1f MB", freed / 1024 / 1024)
        write_text(PID_FILE, str(os.getpid()))
        updates.consume_outcome()
    else:
        logger.warning("Another Lecture Studio server is running (pid %s): temp/ and pid file left alone", read_text(PID_FILE).strip())
    if not ffmpeg_available():
        logger.error("FFmpeg/FFprobe not found in PATH")
    imported = Library.import_untracked()
    migrated = migrate_all()
    if owner:
        from backend.services import attachments

        attachments.cleanup_orphans()
        from backend.services import feedback as reports

        reports.cleanup()
        threading.Thread(target=reports.flush, name="feedback-outbox", daemon=True).start()  # network: off the startup path
    logger.info("Library ready: %d imported, %d migrated, data=%s", imported, migrated, data.data_dir)
    yield
    if read_text(PID_FILE).strip() == str(os.getpid()):
        remove_file(PID_FILE)
        clear_dir(paths().temp)


def create_app() -> FastAPI:
    app = FastAPI(title=APP_NAME, version=APP_VERSION, lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=FRONTEND_ORIGINS, allow_methods=["*"], allow_headers=["*"])
    app.add_middleware(LocalOriginWrites)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=LOCAL_HOSTS)  # added last = runs first

    for module in (system, settings, projects, lessons, jobs, assistant, diary, feedback):
        app.include_router(module.router)

    @app.exception_handler(QueueFull)
    def queue_full(_: Request, e: QueueFull) -> JSONResponse:  # every route that starts a job
        return JSONResponse(status_code=429, content={"detail": str(e)})

    return app

