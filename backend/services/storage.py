"""
Library storage: projects, lessons and assistant threads in notebook_db.json,
lesson artifacts in <data_dir>/output/<job_id>/.

Every read-modify-write holds two locks: a thread lock (pipeline threads, API handlers) and a lock file
beside the db (the MCP server is a separate process writing the same file). Reads need neither: writes
replace the file atomically. After an MCP write the MCP server rewrites the library signal, and the running
app reloads what is open (announce_change / change_signal).
"""

import threading
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from filelock import FileLock

from backend.i18n import tr
from backend.models.lesson import Lesson, LessonFull, LessonPatch
from backend.models.project import INBOX_ID, Project, ProjectCreate, ProjectPatch
from backend.models.transcript import Segment
from backend.settings import paths
from backend.utils.fs import read_json, read_text, remove_dir, write_json, write_text


class Artifacts:
    """Canonical artifact file names inside a lesson folder."""

    SEGMENTS = "segments.json"
    TIME_MAP = "time_map.json"
    AUDIO = "clean_speech.mp3"
    VIDEO = "clean_video.mp4"
    AUDIT = "lesson_audit.md"
    AUDIT_ORIG_BACKUP = "lesson_audit.orig.md"
    PLAIN = "transcript_plain.txt"
    CLEAN_TS = "transcript_clean_timestamps.txt"
    ORIG_TS = "transcript_orig_timestamps.txt"
    CLEAN_SRT = "transcript_clean.srt"
    ORIG_SRT = "transcript_orig.srt"

    # download kind -> (file, mime)
    DOWNLOADS = {
        "audio": (AUDIO, "audio/mpeg"),
        "video": (VIDEO, "video/mp4"),
        "audit": (AUDIT, "text/markdown; charset=utf-8"),
        "srt": (CLEAN_SRT, "application/x-subrip; charset=utf-8"),
        "orig_srt": (ORIG_SRT, "application/x-subrip; charset=utf-8"),
        "txt": (PLAIN, "text/plain; charset=utf-8"),
        "clean_ts": (CLEAN_TS, "text/plain; charset=utf-8"),
        "orig_ts": (ORIG_TS, "text/plain; charset=utf-8"),
        "segments": (SEGMENTS, "application/json"),
        "time_map": (TIME_MAP, "application/json"),
    }


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


# The Inbox keeps "" as its name and description until the user sets them: the UI shows them in its own language.
# Older libraries stored the Russian defaults: those count as unset.
_OLD_INBOX_DEFAULTS = {"Входящие", "Неразобранные уроки", "Неразобранные записи"}


def _empty_db() -> dict[str, Any]:
    return {
        "projects": [{"id": INBOX_ID, "name": "", "description": "", "created_at": _now()}],
        "lessons": [],
        "threads": {},
    }


class LibraryDB:
    """notebook_db.json: the locked read-modify-write transaction, plain reads, and the cross-process change signal."""

    _lock = threading.RLock()
    _file_locks: dict[Path, FileLock] = {}

    @classmethod
    def _load(cls) -> dict[str, Any]:
        db = read_json(paths().db, default=None)
        if not isinstance(db, dict):
            db = _empty_db()
        db.setdefault("projects", [])
        db.setdefault("threads", {})
        lessons = db.get("lessons") or []
        db["lessons"] = list(lessons.values()) if isinstance(lessons, dict) else lessons
        if not any(p.get("id") == INBOX_ID for p in db["projects"]):
            db["projects"].insert(0, _empty_db()["projects"][0])
        for p in db["projects"]:
            if p.get("id") == INBOX_ID:
                for key in ("name", "description"):
                    if p.get(key) in _OLD_INBOX_DEFAULTS:
                        p[key] = ""
        return db

    @classmethod
    def _db_lock(cls) -> FileLock:
        """The cross-process half of the transaction lock; one object per db, so a nested tx re-enters it."""
        path = paths().db_lock
        if path not in cls._file_locks:
            path.parent.mkdir(parents=True, exist_ok=True)
            cls._file_locks[path] = FileLock(path, timeout=30)
        return cls._file_locks[path]

    @classmethod
    @contextmanager
    def tx(cls) -> Iterator[dict[str, Any]]:
        """Locked read-modify-write transaction (this process's threads and the MCP server alike)."""
        with cls._lock, cls._db_lock():
            db = cls._load()
            yield db
            write_json(paths().db, db)

    @staticmethod
    def announce_change() -> None:
        """Called by another process (the MCP server) after it changed the library: the running app reloads."""
        write_text(paths().library_signal, uuid.uuid4().hex)

    @staticmethod
    def change_signal() -> str:
        """What announce_change wrote last ("" = never); the app polls it and compares."""
        return read_text(paths().library_signal)

    @classmethod
    def read(cls) -> dict[str, Any]:
        with cls._lock:
            return cls._load()


class LessonFiles:
    """Where a lesson's files are: its folder, the original recording (Eco keeps it where it was), the media to play."""

    @staticmethod
    def original_of(lesson_dir: Path, original_file: str) -> Path:
        """original_file is an absolute path (Eco: left where it was) or a file name inside the lesson folder."""
        p = Path(original_file)
        return p if p.is_absolute() else lesson_dir / p

    @classmethod
    def original(cls, lesson: Lesson) -> Path | None:
        """The recording a lesson plays from directly (video "original"), wherever it lives."""
        return LessonFiles.original_of(LessonFiles.dir(lesson), lesson.original_file) if lesson.original_file else None

    @classmethod
    def media(cls, lesson: Lesson, kind: Literal["audio", "video"]) -> Path | None:
        """The file the player, export and MCP use: the lesson's own copy, else the original recording. None = absent."""
        own = LessonFiles.dir(lesson) / (Artifacts.AUDIO if kind == "audio" else Artifacts.VIDEO)
        if own.is_file():
            return own
        original = LessonFiles.original(lesson)
        if original and original.is_file() and (kind == "audio" or lesson.original_kind == "video"):
            return original
        return None

    @staticmethod
    def dir(lesson: Lesson | dict[str, Any]) -> Path:
        job_id = lesson.job_id if isinstance(lesson, Lesson) else lesson["job_id"]
        return paths().lesson_dir(job_id)


class Projects:
    """Notebooks: list with lesson counts, create, rename, cover, delete (their lessons go to the Inbox)."""

    @classmethod
    def all(cls) -> list[Project]:
        db = LibraryDB.read()
        counts: dict[str, int] = {}
        for l in db["lessons"]:
            pid = l.get("project_id", INBOX_ID)
            counts[pid] = counts.get(pid, 0) + 1
        return [Project(**{**p, "lesson_count": counts.get(p["id"], 0)}) for p in db["projects"]]

    @classmethod
    def get(cls, project_id: str) -> Project | None:
        return next((p for p in Projects.all() if p.id == project_id), None)

    @classmethod
    def create(cls, data: ProjectCreate) -> Project:
        project = Project(id=f"proj_{uuid.uuid4().hex[:8]}", name=data.name.strip(), description=data.description.strip())
        with LibraryDB.tx() as db:
            db["projects"].append(project.model_dump(exclude={"lesson_count"}))
        return project

    @classmethod
    def patch(cls, project_id: str, patch: ProjectPatch) -> Project | None:
        with LibraryDB.tx() as db:
            for p in db["projects"]:
                if p["id"] == project_id:
                    p.update({k: v.strip() for k, v in patch.model_dump(exclude_none=True).items()})
                    break
            else:
                return None
        return Projects.get(project_id)

    @classmethod
    def delete(cls, project_id: str) -> bool:
        if project_id == INBOX_ID:
            return False
        with LibraryDB.tx() as db:
            before = len(db["projects"])
            db["projects"] = [p for p in db["projects"] if p["id"] != project_id]
            if len(db["projects"]) == before:
                return False
            for l in db["lessons"]:
                if l.get("project_id") == project_id:
                    l["project_id"] = INBOX_ID
            db["threads"].pop(f"project:{project_id}", None)
        from backend.services import covers

        covers.remove_files(project_id)
        return True

    @classmethod
    def set_cover(cls, project_id: str, cover: str) -> Project | None:
        with LibraryDB.tx() as db:
            row = next((p for p in db["projects"] if p["id"] == project_id), None)
            if row is None:
                return None
            row["cover"] = cover
        return Projects.get(project_id)


class Lessons:
    """Lessons in the db plus their artifact flags from disk; the full package (transcript, audit, media URLs)."""

    @classmethod
    def all(
        cls,
        project_id: str | None = None,
        status: str | None = None,
        search: str | None = None,
    ) -> list[Lesson]:
        lessons = [Lesson(**l) for l in LibraryDB.read()["lessons"]]
        if project_id:
            lessons = [l for l in lessons if l.project_id == project_id]
        if status:
            lessons = [l for l in lessons if l.status == status]
        if search:
            q = search.lower().strip()
            lessons = [l for l in lessons if q in f"{l.title}\n{l.notes}\n{l.tags}".lower()]
        return sorted(lessons, key=lambda l: l.created_at, reverse=True)

    @classmethod
    def get(cls, lesson_or_job_id: str) -> Lesson | None:
        for l in LibraryDB.read()["lessons"]:
            if lesson_or_job_id in (l.get("id"), l.get("job_id")):
                return Lesson(**l)
        return None

    @classmethod
    def get_full(cls, lesson_or_job_id: str) -> LessonFull | None:
        lesson = Lessons.get(lesson_or_job_id)
        if not lesson:
            return None
        d = LessonFiles.dir(lesson)
        segments = read_json(d / Artifacts.SEGMENTS, default=[]) or []
        time_map = read_json(d / Artifacts.TIME_MAP, default=[]) or []
        if isinstance(time_map, dict):
            time_map = time_map.get("segments", [])
        has_audio = LessonFiles.media(lesson, "audio") is not None
        has_video = LessonFiles.media(lesson, "video") is not None
        original = LessonFiles.original(lesson)
        return LessonFull(
            **{**lesson.model_dump(), "has_video": has_video},
            segments=[Segment(**s) for s in segments],
            time_map=time_map,
            lesson_audit_md=read_text(d / Artifacts.AUDIT),
            plain_text=read_text(d / Artifacts.PLAIN),
            clean_timestamps_text=read_text(d / Artifacts.CLEAN_TS),
            orig_timestamps_text=read_text(d / Artifacts.ORIG_TS),
            srt_text=read_text(d / Artifacts.CLEAN_SRT),
            audio_url=f"/api/lessons/{lesson.id}/media/audio" if has_audio else None,
            video_url=f"/api/lessons/{lesson.id}/media/video" if has_video else None,
            source_missing=bool(original) and not original.is_file(),
        )

    @classmethod
    def save(cls, lesson: Lesson) -> Lesson:
        """Insert or replace by id; artifact flags are always recomputed from disk."""
        d = LessonFiles.dir(lesson)
        lesson = lesson.model_copy(update={
            "has_transcription": (d / Artifacts.SEGMENTS).is_file() or (d / Artifacts.PLAIN).is_file(),
            "has_audit": (d / Artifacts.AUDIT).is_file(),
            "has_video": (d / Artifacts.VIDEO).is_file() or (lesson.original_kind == "video" and bool(lesson.original_file)),
        })
        with LibraryDB.tx() as db:
            rows = db["lessons"]
            idx = next((i for i, l in enumerate(rows) if l.get("id") == lesson.id), None)
            if idx is None:
                rows.append(lesson.model_dump())
            else:
                rows[idx] = lesson.model_dump()
        return lesson

    @classmethod
    def patch(cls, lesson_id: str, patch: LessonPatch) -> Lesson | None:
        lesson = Lessons.get(lesson_id)
        if not lesson:
            return None
        update = patch.model_dump(exclude_none=True)
        if "bookmarks" in update:
            update["bookmarks"] = sorted(update["bookmarks"], key=lambda b: b["t"])
        return Lessons.save(Lesson(**{**lesson.model_dump(), **update}))

    @classmethod
    def refresh_flags(cls, lesson_id: str) -> Lesson | None:
        lesson = Lessons.get(lesson_id)
        return Lessons.save(lesson) if lesson else None

    @classmethod
    def delete(cls, lesson_id: str, delete_files: bool = True) -> bool:
        lesson = Lessons.get(lesson_id)
        if not lesson:
            return False
        with LibraryDB.tx() as db:
            db["lessons"] = [l for l in db["lessons"] if l.get("id") != lesson.id]
            db["threads"].pop(f"lesson:{lesson.id}", None)
        if delete_files:
            remove_dir(LessonFiles.dir(lesson))
        return True

    @classmethod
    def import_untracked(cls) -> int:
        """Index lesson folders that exist on disk but not in the DB."""
        output = paths().output
        if not output.is_dir():
            return 0
        known = {l.get("job_id") for l in LibraryDB.read()["lessons"]}
        count = 0
        for d in sorted(output.iterdir()):
            if not d.is_dir() or d.name in known:
                continue
            if not ((d / Artifacts.AUDIO).is_file() or (d / Artifacts.PLAIN).is_file()):
                continue
            tm = read_json(d / Artifacts.TIME_MAP, default=[]) or []
            clean = float(tm[-1]["clean_end"]) if tm else 0.0
            orig = float(tm[-1]["orig_end"]) if tm else clean
            Lessons.save(Lesson(
                id=f"less_{d.name}",
                job_id=d.name,
                title=tr("lesson.imported_title", name=d.name),
                notes=tr("lesson.imported_notes"),
                status="to_review",
                tags="imported",
                created_at=datetime.fromtimestamp(d.stat().st_mtime).isoformat(timespec="seconds"),
                orig_duration_sec=orig,
                clean_duration_sec=clean,
                saved_percent=round((orig - clean) / orig * 100, 1) if orig > 0 else 0.0,
            ))
            count += 1
        return count
