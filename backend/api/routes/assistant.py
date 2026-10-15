"""
Assistant threads: /api/assistant/{project|lesson}/{id}
"""

from typing import List

import aiofiles
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from backend.models.assistant import AskRequest, Attachment, ChatMessage, Thread, ThreadKind
from backend.services import assistant, attachments
from backend.services.jobs import JobRegistry
from backend.services.storage import Library
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
        raise HTTPException(400, detail=str(e))
    if not att or not attachments.file_path(att).is_file():
        raise HTTPException(404, detail="Вложение не найдено")
    return FileResponse(attachments.file_path(att), media_type=att.mime, filename=att.name)


@router.get("/{kind}/{thread_id}", response_model=Thread)
def get_thread(kind: ThreadKind, thread_id: str) -> Thread:
    return Library.get_thread(kind, thread_id)


@router.post("/{kind}/{thread_id}", response_model=List[ChatMessage])
async def ask(kind: ThreadKind, thread_id: str, req: AskRequest) -> List[ChatMessage]:
    try:
        return await run_in_threadpool(assistant.ask, kind, thread_id, req)
    except LookupError as e:
        raise HTTPException(404, detail=str(e))
    except ValueError as e:
        raise HTTPException(400, detail=str(e))
    except Exception as e:
        raise HTTPException(502, detail=f"Ошибка ИИ: {e}")


@router.delete("/{kind}/{thread_id}")
def clear_thread(kind: ThreadKind, thread_id: str) -> dict:
    Library.clear_thread(kind, thread_id)
    return {"ok": True}
