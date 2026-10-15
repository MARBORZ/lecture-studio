"""
Lessons (= notebook sources): metadata, media streaming, downloads, export, audit regeneration.
"""

from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.core.pipeline import start_audit, start_transcription
from backend.models.job import Job, JobOptions
from backend.models.lesson import ExportRequest, ExportResult, Lesson, LessonFull, LessonPatch, LessonStatus
from backend.services.export import export_lesson
from backend.services.storage import Artifacts, Library
from backend.settings import SettingsService
from backend.settings.schema import AIProviderName, AuditMode

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
    """FileResponse serves HTTP Range requests (206), so seeking is instant."""
    name, mime = Artifacts.DOWNLOADS[kind]
    path = Library.lesson_dir(_lesson(lesson_id)) / name
    if not path.is_file():
        raise HTTPException(404, detail="Файл не найден")
    return FileResponse(path, media_type=mime)


@router.get("/{lesson_id}/files/{kind}")
def download(lesson_id: str, kind: str) -> FileResponse:
    if kind not in Artifacts.DOWNLOADS:
        raise HTTPException(400, detail="Неизвестный тип файла")
    lesson = _lesson(lesson_id)
    name, mime = Artifacts.DOWNLOADS[kind]
    path = Library.lesson_dir(lesson) / name
    if not path.is_file():
        raise HTTPException(404, detail="Файл ещё не создан")
    return FileResponse(path, media_type=mime, filename=f"{lesson.title}{path.suffix if kind != 'audit' else '.md'}")


@router.post("/{lesson_id}/export", response_model=ExportResult)
def export(lesson_id: str, req: ExportRequest) -> ExportResult:
    try:
        return export_lesson(lesson_id, req.target_dir, req.title)
    except (ValueError, FileNotFoundError, OSError) as e:
        raise HTTPException(400, detail=str(e)) from e


class AuditRequest(BaseModel):
    provider: AIProviderName | None = None
    audit_mode: AuditMode = "srt_timecodes"


class TranscribeRequest(BaseModel):
    mode: Literal["whisper", "gemini", "deepseek"] = "whisper"  # gemini = Gemini transcription; others = local Whisper


@router.post("/{lesson_id}/transcribe", response_model=Job)
def transcribe(lesson_id: str, req: TranscribeRequest) -> Job:
    """Recognize speech again from the lesson's clean audio (e.g. after the cloud was unavailable); media is kept."""
    lesson = _lesson(lesson_id)
    if not (Library.lesson_dir(lesson) / Artifacts.AUDIO).is_file():
        raise HTTPException(400, detail="У урока нет чистого аудио")
    if req.mode == "gemini" and not SettingsService.api_key("gemini"):
        raise HTTPException(400, detail="Нет API-ключа Gemini. Настройки → ИИ")
    defaults = SettingsService.get().pipeline
    options = JobOptions(**{**defaults.model_dump(), "mode": req.mode, "clean_video": False, "project_id": lesson.project_id})
    return start_transcription(lesson, options)


@router.post("/{lesson_id}/audit", response_model=Job)
def regenerate_audit(lesson_id: str, req: AuditRequest) -> Job:
    lesson = _lesson(lesson_id)
    if not lesson.has_transcription:
        raise HTTPException(400, detail="У урока нет стенограммы")
    provider = req.provider or SettingsService.get().ai.assistant_provider
    if not SettingsService.api_key(provider):
        raise HTTPException(400, detail=f"Нет API-ключа {provider}. Настройки → ИИ")
    return start_audit(lesson, provider, req.audit_mode)
