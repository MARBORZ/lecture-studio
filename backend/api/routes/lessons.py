"""
Lessons (= notebook sources): metadata, media streaming, downloads, export, audit regeneration.
"""

from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.core.media import MediaError, check_input, encode_mp3
from backend.core.pipeline import start_audit, start_transcription
from backend.models.job import Job, JobOptions
from backend.models.lesson import ExportRequest, ExportResult, Lesson, LessonFull, LessonPatch, LessonStatus
from backend.services.export import export_lesson
from backend.services.storage import Artifacts, Library
from backend.settings import SettingsService
from backend.settings.schema import AIProviderName, AuditMode, AuditSource, OutputLanguage
from backend.utils.fs import remove_file, to_path

router = APIRouter(prefix="/api/lessons", tags=["lessons"])


def _lesson(lesson_id: str) -> Lesson:
    lesson = Library.get_lesson(lesson_id)
    if not lesson:
        raise HTTPException(404, detail="Урок не найден")
    return lesson


@router.get("", response_model=list[Lesson])
def list_lessons(project_id: str | None = None, status: LessonStatus | None = None, search: str | None = None) -> list[Lesson]:
    return Library.list_lessons(project_id, status, search)


@router.get("/{lesson_id}", response_model=LessonFull)
def get_lesson(lesson_id: str) -> LessonFull:
    lesson = Library.get_lesson_full(lesson_id)
    if not lesson:
        raise HTTPException(404, detail="Урок не найден")
    return lesson


@router.patch("/{lesson_id}", response_model=Lesson)
def patch_lesson(lesson_id: str, patch: LessonPatch) -> Lesson:
    if patch.project_id and not Library.get_project(patch.project_id):
        raise HTTPException(400, detail="Блокнот не найден")
    lesson = Library.patch_lesson(lesson_id, patch)
    if not lesson:
        raise HTTPException(404, detail="Урок не найден")
    return lesson


@router.delete("/{lesson_id}")
def delete_lesson(lesson_id: str, delete_files: bool = True) -> dict:
    if not Library.delete_lesson(lesson_id, delete_files):
        raise HTTPException(404, detail="Урок не найден")
    return {"ok": True}


@router.get("/{lesson_id}/media/{kind}")
def stream_media(lesson_id: str, kind: Literal["audio", "video"]) -> FileResponse:
    """FileResponse serves HTTP Range requests (206), so seeking is instant. The lesson's own copy, or the original
    recording (Eco / kept upload) — its type is guessed from the extension."""
    path = Library.media_file(_lesson(lesson_id), kind)
    if path is None:
        raise HTTPException(404, detail="Файл не найден")
    own = path.name in (Artifacts.AUDIO, Artifacts.VIDEO)
    return FileResponse(path, media_type=Artifacts.DOWNLOADS[kind][1] if own else None)


@router.get("/{lesson_id}/files/{kind}")
def download(lesson_id: str, kind: str) -> FileResponse:
    if kind not in Artifacts.DOWNLOADS:
        raise HTTPException(400, detail="Неизвестный тип файла")
    lesson = _lesson(lesson_id)
    name, mime = Artifacts.DOWNLOADS[kind]
    path = Library.media_file(lesson, kind) if kind in ("audio", "video") else Library.lesson_dir(lesson) / name
    if path is None or not path.is_file():
        raise HTTPException(404, detail="Файл ещё не создан")
    own = path.name == name
    return FileResponse(path, media_type=mime if own else None, filename=f"{lesson.title}{path.suffix if kind != 'audit' else '.md'}")


@router.post("/{lesson_id}/export", response_model=ExportResult)
def export(lesson_id: str, req: ExportRequest) -> ExportResult:
    try:
        return export_lesson(lesson_id, req.target_dir, req.title)
    except (ValueError, FileNotFoundError, OSError) as e:
        raise HTTPException(400, detail=str(e)) from e


class AuditRequest(BaseModel):
    provider: AIProviderName | None = None
    audit_mode: AuditMode = "srt_timecodes"
    source: AuditSource = "transcript"  # video: Gemini watches an optimized copy of the lesson's video
    language: OutputLanguage = "interface"


class TranscribeRequest(BaseModel):
    transcriber: Literal["whisper", "gemini"] = "whisper"


class RelinkRequest(BaseModel):
    path: str


@router.post("/{lesson_id}/transcribe", response_model=Job)
def transcribe(lesson_id: str, req: TranscribeRequest) -> Job:
    """Recognize speech again from the lesson's clean audio (e.g. after the cloud was unavailable); media is kept."""
    lesson = _lesson(lesson_id)
    if Library.media_file(lesson, "audio") is None:
        raise HTTPException(400, detail="Нет аудио урока (или исходный файл не найден по сохранённому пути)")
    if req.transcriber == "gemini" and not SettingsService.api_key("gemini"):
        raise HTTPException(400, detail="Нет API-ключа Gemini. Настройки → ИИ")
    defaults = SettingsService.get().pipeline
    options = JobOptions(**{**defaults.model_dump(), "transcriber": req.transcriber, "video": "none", "project_id": lesson.project_id})
    return start_transcription(lesson, options)


@router.post("/{lesson_id}/audit", response_model=Job)
def regenerate_audit(lesson_id: str, req: AuditRequest) -> Job:
    lesson = _lesson(lesson_id)
    provider = req.provider or SettingsService.get().ai.assistant_provider
    if req.source == "video":
        if provider != "gemini":
            raise HTTPException(400, detail="Аудит по видео делает только Gemini")
        if Library.media_file(lesson, "video") is None:
            raise HTTPException(400, detail="У урока нет видео")
    elif not lesson.has_transcription:
        raise HTTPException(400, detail="У урока нет стенограммы")
    if not SettingsService.api_key(provider):
        raise HTTPException(400, detail=f"Нет API-ключа {provider}. Настройки → ИИ")
    return start_audit(lesson, provider, req.audit_mode, req.source, req.language)


@router.post("/{lesson_id}/drop-video", response_model=Lesson)
def drop_video(lesson_id: str) -> Lesson:
    """Keep the sound, free the space: the lesson becomes an audio lesson (same timeline, transcript and audit).
    The lesson's video copy is deleted; a kept upload gives its sound to clean_speech.mp3 first; a file of the user's
    own (Eco, an absolute path) is never deleted — the lesson just stops showing its picture."""
    lesson = _lesson(lesson_id)
    folder = Library.lesson_dir(lesson)
    remove_file(folder / Artifacts.VIDEO)
    update: dict = {}
    if lesson.original_kind == "video":
        original = Library.original_path(lesson)
        if Path(lesson.original_file).is_absolute():
            update = {"original_kind": "audio"}
        else:
            if original and original.is_file():
                if not (folder / Artifacts.AUDIO).is_file():
                    encode_mp3(original, folder / Artifacts.AUDIO, "128k")
                remove_file(original)
            update = {"original_file": "", "original_kind": ""}
    return Library.save_lesson(lesson.model_copy(update=update))


@router.post("/{lesson_id}/relink", response_model=Lesson)
def relink(lesson_id: str, req: RelinkRequest) -> Lesson:
    """Eco: the original was moved or renamed — point the lesson at its new path. The file must be the same recording
    (same length), so timecodes, transcript and audit stay right."""
    lesson = _lesson(lesson_id)
    if not lesson.original_file or not Path(lesson.original_file).is_absolute():
        raise HTTPException(400, detail="Урок не ссылается на внешний файл")
    path = to_path(req.path)
    if not path.is_file():
        raise HTTPException(400, detail=f"Файл не найден: {path}")
    try:
        duration = check_input(path)
    except MediaError as e:
        raise HTTPException(400, detail=str(e)) from e
    if lesson.orig_duration_sec and abs(duration - lesson.orig_duration_sec) > max(2.0, lesson.orig_duration_sec * 0.01):
        raise HTTPException(400, detail=f"Это другая запись: {duration:.0f} с вместо {lesson.orig_duration_sec:.0f} с")
    return Library.save_lesson(lesson.model_copy(update={"original_file": str(path.resolve())}))
