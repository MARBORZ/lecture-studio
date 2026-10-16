"""Bug reports and ideas to the developer (services/feedback.py): a draft, its files, then send."""

import aiofiles
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from backend.i18n import tr
from backend.models.feedback import FeedbackDraft, FeedbackFile, FeedbackResult, FeedbackSend
from backend.services import feedback

router = APIRouter(prefix="/api/feedback", tags=["feedback"])


def _bad(e: Exception) -> HTTPException:
    return HTTPException(400, detail=str(e))


@router.post("/drafts", response_model=FeedbackDraft)
def new_draft() -> FeedbackDraft:
    return feedback.new_draft()


@router.put("/drafts/{draft_id}/files/{filename}", response_model=FeedbackFile)
async def upload_file(draft_id: str, filename: str, request: Request) -> FeedbackFile:
    """Raw streamed upload, cut off at the per-file / total cap."""
    try:
        dest, cap = feedback.file_slot(draft_id, filename)
    except feedback.FeedbackError as e:
        raise _bad(e) from None
    size = 0
    try:
        async with aiofiles.open(dest, "wb") as f:
            async for chunk in request.stream():
                size += len(chunk)
                if size > cap:
                    raise HTTPException(413, detail=tr("feedback.too_big", mb=feedback.MAX_TOTAL_BYTES // (1024 * 1024)))
                await f.write(chunk)
    except BaseException:
        dest.unlink(missing_ok=True)
        raise
    if size == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, detail=tr("file.empty"))
    return feedback.file_info(dest)


@router.delete("/drafts/{draft_id}/files/{filename}")
def delete_file(draft_id: str, filename: str) -> dict:
    try:
        feedback.remove_file(draft_id, filename)
    except feedback.FeedbackError as e:
        raise _bad(e) from None
    return {"ok": True}


@router.delete("/drafts/{draft_id}")
def discard(draft_id: str) -> dict:
    feedback.discard(draft_id)
    return {"ok": True}


@router.post("/drafts/{draft_id}/send", response_model=FeedbackResult)
async def send(draft_id: str, form: FeedbackSend) -> FeedbackResult:
    try:
        return await run_in_threadpool(feedback.send, draft_id, form)
    except feedback.TooSoon as e:
        raise HTTPException(429, detail=str(e), headers={"Retry-After": str(e.retry_after)}) from None
    except feedback.FeedbackError as e:
        raise _bad(e) from None
