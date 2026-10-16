"""
Export a lesson into a local folder (Obsidian vault layout):
  audio/  compressed/  content/  srt/  txt/  <Title>.md
"""

import logging
from pathlib import Path

from backend.i18n import tr
from backend.models.lesson import ExportResult
from backend.services.jobs import JobRegistry
from backend.services.storage import Artifacts, Library
from backend.settings import SettingsService
from backend.utils.fs import copy_file, ensure_dir, sanitize_filename, to_path

logger = logging.getLogger(__name__)

# (artifact, subfolder, name template)
# Audio and video come through Library.media_file (the lesson's copy or the original recording), see export_lesson.
EXPORT_RULES: list[tuple[str, str, str]] = [
    (Artifacts.TIME_MAP, "compressed", "{title}_time_map.json"),
    (Artifacts.SEGMENTS, "compressed", "{title}_segments.json"),
    (Artifacts.CLEAN_SRT, "srt", "{title}.srt"),
    (Artifacts.ORIG_SRT, "srt", "{title}_orig.srt"),
    (Artifacts.PLAIN, "txt", "{title}.txt"),
    (Artifacts.CLEAN_TS, "txt", "{title}_timestamps.txt"),
    (Artifacts.ORIG_TS, "txt", "{title}_orig_timestamps.txt"),
    (Artifacts.AUDIT, "content", "{title}_audit.md"),
    (Artifacts.AUDIT, "", "{title}.md"),
]

FOLDERS = ("audio", "compressed", "content", "srt", "txt")


def export_lesson(
    lesson_id: str,
    target_dir: str | None = None,
    title: str | None = None,
    raw_wav: Path | None = None,
) -> ExportResult:
    lesson = Library.get_lesson(lesson_id)
    if not lesson:
        raise FileNotFoundError(tr("export.lesson_not_found", id=lesson_id))
    target = target_dir or SettingsService.get().export_dir
    if not target:
        raise ValueError(tr("export.no_folder"))

    src = Library.lesson_dir(lesson)
    base = ensure_dir(to_path(target))
    safe_title = sanitize_filename(title or lesson.title)

    with JobRegistry.exporting():
        for folder in FOLDERS:
            ensure_dir(base / folder)
        files = []
        media = {kind: Library.media_file(lesson, kind) for kind in ("video", "audio")}
        for kind, path in media.items():
            if path and not (kind == "audio" and path == media["video"]):  # an original with sound: exported once
                suffix = "" if path.name in (Artifacts.AUDIO, Artifacts.VIDEO) else "_original"
                if dest := copy_file(path, base / "compressed" / f"{safe_title}{suffix}{path.suffix}"):
                    files.append(str(dest))
        files += [
            str(dest)
            for name, sub, tpl in EXPORT_RULES
            if (dest := copy_file(src / name, (base / sub if sub else base) / tpl.format(title=safe_title)))
        ]
        if raw_wav and (copied := copy_file(raw_wav, base / "audio" / f"{safe_title}_raw.wav")):
            files.append(str(copied))

    logger.info("Exported %d files for %s -> %s", len(files), lesson.id, base)
    return ExportResult(target_dir=str(base), title=safe_title, count=len(files), files=files)
