"""
Library storage: projects, lessons and assistant threads in notebook_db.json,
lesson artifacts in <data_dir>/output/<job_id>/.

Every read-modify-write runs inside one process-wide lock, so pipeline threads,
API handlers and the MCP server (separate process; atomic file replace) never interleave writes.
"""

import threading
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any

from backend.models.lesson import Lesson, LessonFull, LessonPatch
from backend.models.project import INBOX_ID, Project, ProjectCreate, ProjectPatch
from backend.models.transcript import Segment
from backend.settings import paths
from backend.utils.fs import read_json, read_text, remove_dir, write_json


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


def _empty_db() -> dict[str, Any]:
    return {
        "projects": [{"id": INBOX_ID, "name": "Входящие", "description": "Неразобранные записи", "created_at": _now()}],
        "lessons": [],
        "threads": {},
    }


class Library:
    _lock = threading.RLock()

    # ---------------- low level ----------------

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
        return db

    @classmethod
    @contextmanager
    def tx(cls) -> Iterator[dict[str, Any]]:
        """Locked read-modify-write transaction."""
        with cls._lock:
            db = cls._load()
            yield db
            write_json(paths().db, db)

    @classmethod
    def read(cls) -> dict[str, Any]:
        with cls._lock:
            return cls._load()

    @staticmethod
    def lesson_dir(lesson: Lesson | dict[str, Any]) -> Path:
        job_id = lesson.job_id if isinstance(lesson, Lesson) else lesson["job_id"]
        return paths().lesson_dir(job_id)

    # ---------------- projects ----------------

    @classmethod
    def list_projects(cls) -> list[Project]:
        db = cls.read()
        counts: dict[str, int] = {}
        for l in db["lessons"]:
            pid = l.get("project_id", INBOX_ID)
            counts[pid] = counts.get(pid, 0) + 1
        return [Project(**{**p, "lesson_count": counts.get(p["id"], 0)}) for p in db["projects"]]

    @classmethod
    def get_project(cls, project_id: str) -> Project | None:
        return next((p for p in cls.list_projects() if p.id == project_id), None)

    @classmethod
    def create_project(cls, data: ProjectCreate) -> Project:
        project = Project(id=f"proj_{uuid.uuid4().hex[:8]}", name=data.name.strip(), description=data.description.strip())
        with cls.tx() as db:
            db["projects"].append(project.model_dump(exclude={"lesson_count"}))
        return project

    @classmethod
    def patch_project(cls, project_id: str, patch: ProjectPatch) -> Project | None:
        with cls.tx() as db:
            for p in db["projects"]:
                if p["id"] == project_id:
                    p.update({k: v.strip() for k, v in patch.model_dump(exclude_none=True).items()})
                    break
            else:
                return None
        return cls.get_project(project_id)

    @classmethod
    def delete_project(cls, project_id: str) -> bool:
        if project_id == INBOX_ID:
            return False
        with cls.tx() as db:
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
    def set_project_cover(cls, project_id: str, cover: str) -> Project | None:
        with cls.tx() as db:
            row = next((p for p in db["projects"] if p["id"] == project_id), None)
            if row is None:
                return None
            row["cover"] = cover
        return cls.get_project(project_id)

    # ---------------- lessons ----------------

    @classmethod
    def list_lessons(
        cls,
        project_id: str | None = None,
        status: str | None = None,
        search: str | None = None,
    ) -> list[Lesson]:
        lessons = [Lesson(**l) for l in cls.read()["lessons"]]
        if project_id:
            lessons = [l for l in lessons if l.project_id == project_id]
        if status:
            lessons = [l for l in lessons if l.status == status]
        if search:
            q = search.lower().strip()
            lessons = [l for l in lessons if q in f"{l.title}\n{l.notes}\n{l.tags}".lower()]
        return sorted(lessons, key=lambda l: l.created_at, reverse=True)

    @classmethod
    def get_lesson(cls, lesson_or_job_id: str) -> Lesson | None:
        for l in cls.read()["lessons"]:
            if lesson_or_job_id in (l.get("id"), l.get("job_id")):
                return Lesson(**l)
        return None

    @classmethod
    def get_lesson_full(cls, lesson_or_job_id: str) -> LessonFull | None:
        lesson = cls.get_lesson(lesson_or_job_id)
        if not lesson:
            return None
        d = cls.lesson_dir(lesson)
        segments = read_json(d / Artifacts.SEGMENTS, default=[]) or []
        time_map = read_json(d / Artifacts.TIME_MAP, default=[]) or []
        if isinstance(time_map, dict):
            time_map = time_map.get("segments", [])
        has_audio = (d / Artifacts.AUDIO).is_file()
        has_video = (d / Artifacts.VIDEO).is_file()
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
        )

    @classmethod
    def save_lesson(cls, lesson: Lesson) -> Lesson:
        """Insert or replace by id; artifact flags are always recomputed from disk."""
        d = cls.lesson_dir(lesson)
        lesson = lesson.model_copy(update={
            "has_transcription": (d / Artifacts.SEGMENTS).is_file() or (d / Artifacts.PLAIN).is_file(),
            "has_audit": (d / Artifacts.AUDIT).is_file(),
            "has_video": (d / Artifacts.VIDEO).is_file(),
        })
        with cls.tx() as db:
            rows = db["lessons"]
            idx = next((i for i, l in enumerate(rows) if l.get("id") == lesson.id), None)
            if idx is None:
                rows.append(lesson.model_dump())
            else:
                rows[idx] = lesson.model_dump()
        return lesson

    @classmethod
    def patch_lesson(cls, lesson_id: str, patch: LessonPatch) -> Lesson | None:
        lesson = cls.get_lesson(lesson_id)
        if not lesson:
            return None
        update = patch.model_dump(exclude_none=True)
        if "bookmarks" in update:
            update["bookmarks"] = sorted(update["bookmarks"], key=lambda b: b["t"])
        return cls.save_lesson(Lesson(**{**lesson.model_dump(), **update}))

    @classmethod
    def refresh_flags(cls, lesson_id: str) -> Lesson | None:
        lesson = cls.get_lesson(lesson_id)
        return cls.save_lesson(lesson) if lesson else None

    @classmethod
    def delete_lesson(cls, lesson_id: str, delete_files: bool = True) -> bool:
        lesson = cls.get_lesson(lesson_id)
        if not lesson:
            return False
        with cls.tx() as db:
            db["lessons"] = [l for l in db["lessons"] if l.get("id") != lesson.id]
            db["threads"].pop(f"lesson:{lesson.id}", None)
        if delete_files:
            remove_dir(cls.lesson_dir(lesson))
        return True

    @classmethod
    def import_untracked(cls) -> int:
        """Index lesson folders that exist on disk but not in the DB."""
        output = paths().output
        if not output.is_dir():
            return 0
        known = {l.get("job_id") for l in cls.read()["lessons"]}
        count = 0
        for d in sorted(output.iterdir()):
            if not d.is_dir() or d.name in known:
                continue
            if not ((d / Artifacts.AUDIO).is_file() or (d / Artifacts.PLAIN).is_file()):
                continue
            tm = read_json(d / Artifacts.TIME_MAP, default=[]) or []
            clean = float(tm[-1]["clean_end"]) if tm else 0.0
            orig = float(tm[-1]["orig_end"]) if tm else clean
            cls.save_lesson(Lesson(
                id=f"less_{d.name}",
                job_id=d.name,
                title=f"Запись {d.name}",
                notes="Импортировано с диска",
                status="to_review",
                tags="imported",
                created_at=datetime.fromtimestamp(d.stat().st_mtime).isoformat(timespec="seconds"),
                orig_duration_sec=orig,
                clean_duration_sec=clean,
                saved_percent=round((orig - clean) / orig * 100, 1) if orig > 0 else 0.0,
            ))
            count += 1
        return count
