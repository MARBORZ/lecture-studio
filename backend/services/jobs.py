"""
In-memory job registry plus activity counters (uploads, exports).
It is the single authority on "is the system busy?" used by shutdown and data-dir changes.
"""

import builtins
import threading
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime

from backend.models.job import ACTIVE_STATUSES, Job, JobKind, Stage
from backend.models.system import BusyReason

MAX_HISTORY = 50


class JobCancelled(Exception):
    """Raised inside a pipeline when the user cancelled the job."""


class JobRegistry:
    _lock = threading.RLock()
    _jobs: dict[str, Job] = {}
    _uploads = 0
    _exports = 0

    # ---------------- jobs ----------------

    @classmethod
    def create(cls, kind: JobKind, title: str, stages: list[Stage]) -> Job:
        job = Job(id=uuid.uuid4().hex[:8], kind=kind, title=title, stages=stages, message="В очереди")
        with cls._lock:
            cls._jobs[job.id] = job
            finished = [j for j in cls._jobs.values() if not j.active]
            for old in finished[: max(0, len(cls._jobs) - MAX_HISTORY)]:
                cls._jobs.pop(old.id, None)
        return job

    @classmethod
    def get(cls, job_id: str) -> Job | None:
        with cls._lock:
            job = cls._jobs.get(job_id)
            return job.model_copy() if job else None

    @classmethod
    def list(cls) -> list[Job]:
        with cls._lock:
            return [j.model_copy() for j in reversed(cls._jobs.values())]

    @classmethod
    def active(cls) -> builtins.list[Job]:
        return [j for j in cls.list() if j.status in ACTIVE_STATUSES]

    @classmethod
    def update(cls, job_id: str, **fields) -> None:
        with cls._lock:
            job = cls._jobs.get(job_id)
            if not job:
                return
            if fields.get("status") in ("completed", "error", "cancelled"):
                fields.setdefault("finished_at", datetime.now().isoformat(timespec="seconds"))
            cls._jobs[job_id] = job.model_copy(update=fields)

    @classmethod
    def request_cancel(cls, job_id: str) -> bool:
        with cls._lock:
            job = cls._jobs.get(job_id)
            if not job or not job.active:
                return False
            cls._jobs[job_id] = job.model_copy(update={"cancel_requested": True, "message": "Отмена…"})
            return True

    @classmethod
    def is_cancel_requested(cls, job_id: str) -> bool:
        with cls._lock:
            job = cls._jobs.get(job_id)
            return bool(job and job.cancel_requested)

    # ---------------- activity counters ----------------

    @classmethod
    @contextmanager
    def uploading(cls) -> Iterator[None]:
        with cls._lock:
            cls._uploads += 1
        try:
            yield
        finally:
            with cls._lock:
                cls._uploads -= 1

    @classmethod
    @contextmanager
    def exporting(cls) -> Iterator[None]:
        with cls._lock:
            cls._exports += 1
        try:
            yield
        finally:
            with cls._lock:
                cls._exports -= 1

    @classmethod
    def busy_reasons(cls) -> builtins.list[BusyReason]:
        with cls._lock:
            reasons = [
                BusyReason(kind="job", label=f"{j.title or j.id}: {j.message}", progress=j.progress)
                for j in cls._jobs.values()
                if j.status in ACTIVE_STATUSES
            ]
            if cls._uploads:
                reasons.append(BusyReason(kind="upload", label=f"Загрузка файлов: {cls._uploads}"))
            if cls._exports:
                reasons.append(BusyReason(kind="export", label=f"Экспорт уроков: {cls._exports}"))
            return reasons
