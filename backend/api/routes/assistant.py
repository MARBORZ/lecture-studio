"""
Assistant threads: /api/assistant/{project|lesson}/{id}
"""

from typing import List

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool

from backend.models.assistant import AskRequest, ChatMessage, Thread, ThreadKind
from backend.services import assistant
from backend.services.storage import Library

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


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
