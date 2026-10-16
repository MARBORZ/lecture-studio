"""
Idempotent migration of lessons stored in the older pre-release format (runs at startup).

Current format guarantees:
  * segments.json exists and every derived transcript file is regenerated from it;
  * lesson_audit.md timecodes are on the CLEAN timeline (what the player plays).

Older lessons had no transcript_clean.srt; their audits were generated from
transcript_orig.srt, i.e. on the ORIGINAL timeline. Those timecodes are remapped
orig -> clean through time_map; the untouched audit is kept as lesson_audit.orig.md.
"""

import logging
from pathlib import Path

from backend.core.timeline import TimeMap, parse_srt, rewrite_timecodes
from backend.core.transcription import write_transcripts
from backend.models.lesson import SCHEMA_VERSION, Lesson
from backend.models.transcript import Segment
from backend.services.storage import Artifacts, Library
from backend.utils.fs import copy_file, read_json, read_text, write_text

logger = logging.getLogger(__name__)


def _segments_from_legacy(lesson_dir: Path, tm: TimeMap) -> list[Segment]:
    orig_srt = read_text(lesson_dir / Artifacts.ORIG_SRT)
    if orig_srt.strip():
        return [
            Segment(
                clean_start=tm.orig_to_clean(i["start"]),
                clean_end=tm.orig_to_clean(i["end"]),
                orig_start=round(i["start"], 3),
                orig_end=round(i["end"], 3),
                text=i["text"],
            )
            for i in parse_srt(orig_srt)
        ]
    clean_srt = read_text(lesson_dir / Artifacts.CLEAN_SRT)
    return [
        Segment(
            clean_start=round(i["start"], 3),
            clean_end=round(i["end"], 3),
            orig_start=tm.clean_to_orig(i["start"]),
            orig_end=tm.clean_to_orig(i["end"]),
            text=i["text"],
        )
        for i in parse_srt(clean_srt)
    ]


def migrate_lesson_dir(lesson_dir: Path) -> dict:
    """Migrate one lesson folder in place. Returns a small report (also used by tests)."""
    report = {"segments": 0, "audit_remapped": False}
    tm = TimeMap(read_json(lesson_dir / Artifacts.TIME_MAP, default=[]) or [])
    legacy_audit_on_orig = not (lesson_dir / Artifacts.CLEAN_SRT).is_file()

    if not (lesson_dir / Artifacts.SEGMENTS).is_file():
        segments = _segments_from_legacy(lesson_dir, tm)
        if segments:
            write_transcripts(lesson_dir, segments)
            report["segments"] = len(segments)

    audit_path = lesson_dir / Artifacts.AUDIT
    audit = read_text(audit_path)
    if audit and legacy_audit_on_orig and tm and not (lesson_dir / Artifacts.AUDIT_ORIG_BACKUP).exists():
        copy_file(audit_path, lesson_dir / Artifacts.AUDIT_ORIG_BACKUP)
        write_text(audit_path, rewrite_timecodes(audit, tm.orig_to_clean))
        report["audit_remapped"] = True
    return report


def migrate_all() -> int:
    from backend.services import chats  # sessions out of notebook_db.json into their own folders (once)

    if chats.migrate():
        logger.info("Chat sessions moved into session folders")
    from backend.core.ai import prompts  # the two old audit structure blocks into one (their time format is the contract's)

    if prompts.migrate_overrides():
        logger.info("Prompt overrides: the audit structure blocks merged into one")
    migrated = 0
    for lesson in Library.list_lessons():
        if lesson.schema_version >= SCHEMA_VERSION:
            continue
        lesson_dir = Library.lesson_dir(lesson)
        if lesson_dir.is_dir():
            report = migrate_lesson_dir(lesson_dir)
            logger.info("Migrated %s: %s", lesson.id, report)
        tm = read_json(lesson_dir / Artifacts.TIME_MAP, default=[]) or []
        update = {"schema_version": SCHEMA_VERSION}
        if tm and not lesson.clean_duration_sec:
            update["clean_duration_sec"] = float(tm[-1]["clean_end"])
        Library.save_lesson(Lesson(**{**lesson.model_dump(), **update}))
        migrated += 1
    return migrated
