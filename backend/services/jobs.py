"""
Job registry plus activity counters (uploads, exports).
It is the single authority on "is the system busy?" used by shutdown and data-dir changes.

Live jobs are in memory (the Studio's list). Every finished job is also appended to paths().job_history, so the
history survives restarts and the list can be cleared without losing it: clear_finished() only hides them from the
list, history() pages through all of them.
"""

import builtins
import threading
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime

from backend.i18n import tr
from backend.models.job import ACTIVE_STATUSES, Job, JobKind, JobPage, Stage
from backend.models.system import BusyReason
from backend.settings import SettingsService, paths
from backend.utils.fs import read_json, write_json

MAX_HISTORY = 50  # finished jobs kept in the live list
HISTORY_KEEP = 2000  # finished jobs kept on disk
_FINAL = ("completed", "error", "cancelled")


class JobCancelled(Exception):
    """Raised inside a pipeline when the user cancelled the job."""


class QueueFull(Exception):
    """create() refused: as many jobs wait or run as settings.queue_limit allows. The API answers 429."""


class JobRegistry:
    _lock = threading.RLock()
    _jobs: dict[str, Job] = {}
    _uploads = 0
    _exports = 0

    # ---------------- jobs ----------------

    @classmethod
    def create(cls, kind: JobKind, title: str, stages: list[Stage]) -> Job:
        """Queue a job; the count and the insert are one step, so parallel requests cannot overshoot the limit."""
        limit = SettingsService.get().queue_limit
        job = Job(id=uuid.uuid4().hex[:8], kind=kind, title=title, stages=stages, message=tr("job.queued"))
        with cls._lock:
            if sum(1 for j in cls._jobs.values() if j.active) >= limit:
                raise QueueFull(tr("queue.full", n=limit))
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
            final = fields.get("status") in _FINAL and job.status not in _FINAL
            if final:
                fields.setdefault("finished_at", datetime.now().isoformat(timespec="seconds"))
            cls._jobs[job_id] = job.model_copy(update=fields)
            if final:
                cls._remember(cls._jobs[job_id])

    @classmethod
    def request_cancel(cls, job_id: str) -> bool:
        with cls._lock:
            job = cls._jobs.get(job_id)
            if not job or not job.active:
                return False
            cls._jobs[job_id] = job.model_copy(update={"cancel_requested": True, "message": tr("job.cancelling")})
            return True

    @classmethod
    def is_cancel_requested(cls, job_id: str) -> bool:
        with cls._lock:
            job = cls._jobs.get(job_id)
            return bool(job and job.cancel_requested)

    # ---------------- history ----------------

    @classmethod
    def _remember(cls, job: Job) -> None:
        """Append a finished job to the history file (newest last on disk). Called under the lock."""
        try:
            items = read_json(paths().job_history, [])
            items = [i for i in items if isinstance(i, dict) and i.get("id") != job.id] + [job.model_dump()]
            write_json(paths().job_history, items[-HISTORY_KEEP:])
        except OSError:
            pass  # history is a convenience: a full disk must not fail the job

    @classmethod
    def clear_finished(cls) -> int:
        """Take finished jobs off the Studio's list (they stay in the history)."""
        with cls._lock:
            done = [k for k, j in cls._jobs.items() if not j.active]
            for k in done:
                cls._jobs.pop(k, None)
            return len(done)

    @classmethod
    def history(cls, page: int = 1, size: int = 20) -> JobPage:
        size = max(1, min(size, 100))
        page = max(1, page)
        with cls._lock:
            items = [Job.model_validate(i) for i in reversed(read_json(paths().job_history, [])) if isinstance(i, dict)]
        start = (page - 1) * size
        return JobPage(items=items[start : start + size], total=len(items), page=page, size=size)

    @classmethod
    def clear_history(cls) -> None:
        with cls._lock:
            write_json(paths().job_history, [])

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
                reasons.append(BusyReason(kind="upload", label=tr("busy.uploads", n=cls._uploads)))
            if cls._exports:
                reasons.append(BusyReason(kind="export", label=tr("busy.exports", n=cls._exports)))
            return reasons
