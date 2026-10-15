"""
Export a lesson into a local folder (Obsidian vault layout):
  audio/  compressed/  content/  srt/  txt/  <Title>.md
"""

import logging
from pathlib import Path
from typing import List, Optional, Tuple

from backend.models.lesson import ExportResult
from backend.services.jobs import JobRegistry
from backend.services.storage import Artifacts, Library
from backend.settings import SettingsService
from backend.utils.fs import copy_file, ensure_dir, sanitize_filename, to_path

logger = logging.getLogger(__name__)

# (artifact, subfolder, name template)
EXPORT_RULES: List[Tuple[str, str, str]] = [
    (Artifacts.AUDIO, "compressed", "{title}.mp3"),
    (Artifacts.VIDEO, "compressed", "{title}.mp4"),
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
    target_dir: Optional[str] = None,
    title: Optional[str] = None,
    raw_wav: Optional[Path] = None,
) -> ExportResult:
    lesson = Library.get_lesson(lesson_id)
    if not lesson:
        raise FileNotFoundError(f"Урок {lesson_id} не найден")
    target = target_dir or SettingsService.get().export_dir
    if not target:
        raise ValueError("Не задана папка экспорта: Настройки → Пути")

    src = Library.lesson_dir(lesson)
    base = ensure_dir(to_path(target))
    safe_title = sanitize_filename(title or lesson.title)

    with JobRegistry.exporting():
        for folder in FOLDERS:
            ensure_dir(base / folder)
        files = [
            str(dest)
            for name, sub, tpl in EXPORT_RULES
            if (dest := copy_file(src / name, (base / sub if sub else base) / tpl.format(title=safe_title)))
        ]
        if raw_wav and (copied := copy_file(raw_wav, base / "audio" / f"{safe_title}_raw.wav")):
            files.append(str(copied))

    logger.info("Exported %d files for %s -> %s", len(files), lesson.id, base)
    return ExportResult(target_dir=str(base), title=safe_title, count=len(files), files=files)
