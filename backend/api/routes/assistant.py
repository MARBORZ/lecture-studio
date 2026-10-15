"""
Assistant threads: /api/assistant/{project|lesson}/{id}
"""


import aiofiles
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from backend.models.assistant import AskRequest, Attachment, CompactRequest, SessionInfo, SessionPatch, Thread, ThreadKind
from backend.services import assistant, attachments, chats
from backend.services.jobs import JobRegistry
from backend.settings.schema import AIProviderName
from backend.utils.fs import remove_dir

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


# Attachment routes come first: "/attachments/..." must not be read as a "/{kind}/{id}" thread.

@router.put("/attachments/{filename}", response_model=Attachment)
async def upload_attachment(filename: str, request: Request) -> Attachment:
    """Raw streamed upload of any file; readable formats are converted to text for the model."""
    att_id, dest = attachments.new_slot(filename)
    size = 0
    with JobRegistry.uploading():
        try:
            async with aiofiles.open(dest, "wb") as f:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > attachments.MAX_BYTES:
                        raise HTTPException(413, detail="Файл больше 500 МБ")
                    await f.write(chunk)
        except BaseException:
            remove_dir(dest.parent)
            raise
    if size == 0:
        remove_dir(dest.parent)
        raise HTTPException(400, detail="Пустой файл")
    return await run_in_threadpool(attachments.register, att_id, dest)


@router.get("/attachments/{att_id}/file")
def download_attachment(att_id: str) -> FileResponse:
    try:
        att = attachments.get(att_id)
    except ValueError as e:
        raise HTTPException(400, detail=str(e)) from e
    if not att or not attachments.file_path(att).is_file():
        raise HTTPException(404, detail="Вложение не найдено")
    return FileResponse(attachments.file_path(att), media_type=att.mime, filename=att.name)


# ---------------------------------------------------------------- threads and sessions
# Reads take the same view parameters as a question (provider, selected sources), so the context meter is exact.


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except LookupError as e:
        raise HTTPException(404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(400, detail=str(e)) from e


@router.get("/{kind}/{thread_id}", response_model=Thread)
def get_thread(
    kind: ThreadKind,
    thread_id: str,
    session: str | None = None,
    provider: AIProviderName | None = None,
    sources: list[str] | None = Query(default=None),
) -> Thread:
    return _call(assistant.thread, kind, thread_id, session, provider, sources)


@router.post("/{kind}/{thread_id}", response_model=Thread)
async def ask(kind: ThreadKind, thread_id: str, req: AskRequest) -> Thread:
    try:
        return await run_in_threadpool(_call, assistant.ask, kind, thread_id, req)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, detail=f"Ошибка ИИ: {e}") from e


@router.delete("/{kind}/{thread_id}")
def delete_thread(kind: ThreadKind, thread_id: str) -> dict:
    """Every session of the thread, with their files."""
    chats.delete_all(kind, thread_id)
    return {"ok": True}


@router.post("/{kind}/{thread_id}/sessions", response_model=SessionInfo)
def new_session(kind: ThreadKind, thread_id: str) -> SessionInfo:
    s = chats.create(kind, thread_id)
    return SessionInfo(id=s.id, title=s.title, created_at=s.created_at, updated_at=s.updated_at, messages=len(s.messages))


@router.put("/{kind}/{thread_id}/sessions/{session_id}/active")
def activate_session(kind: ThreadKind, thread_id: str, session_id: str) -> dict:
    _call(chats.activate, kind, thread_id, session_id)
    return {"ok": True}


@router.patch("/{kind}/{thread_id}/sessions/{session_id}")
def patch_session(kind: ThreadKind, thread_id: str, session_id: str, change: SessionPatch) -> dict:
    _call(chats.patch, kind, thread_id, session_id, change)
    return {"ok": True}


@router.post("/{kind}/{thread_id}/sessions/{session_id}/clear")
def clear_session(kind: ThreadKind, thread_id: str, session_id: str) -> dict:
    """History, summary and files of one session: the model starts from the sources only."""
    _call(chats.clear, kind, thread_id, session_id)
    return {"ok": True}


@router.post("/{kind}/{thread_id}/sessions/{session_id}/compact", response_model=Thread)
async def compact_session(kind: ThreadKind, thread_id: str, session_id: str, req: CompactRequest) -> Thread:
    try:
        return await run_in_threadpool(_call, assistant.compact, kind, thread_id, session_id, req.provider, req.sources)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, detail=f"Ошибка ИИ: {e}") from e


@router.delete("/{kind}/{thread_id}/sessions/{session_id}")
def delete_session(kind: ThreadKind, thread_id: str, session_id: str) -> dict:
    _call(chats.delete, kind, thread_id, session_id)
    return {"ok": True}
