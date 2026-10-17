"""
Processing jobs: raw upload, start, live state stream (SSE), cancel.

Upload is a raw streamed PUT straight into <data_dir>/temp (no multipart spooling,
no double copy of multi-GB OBS recordings); the job then references it by upload_id.
"""

import asyncio
import json
import re
import uuid

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.api.upload import receive
from backend.core.media import MediaError, browser_playback_problem, check_input, probe_video
from backend.core.pipeline import start_processing
from backend.i18n import tr
from backend.models.job import Job, JobOptions, JobPage
from backend.services import videos
from backend.services.jobs import JobRegistry
from backend.services.storage import Library
from backend.settings import paths
from backend.utils.fs import remove_file, to_path

router = APIRouter(prefix="/api", tags=["jobs"])


class UploadResult(BaseModel):
    upload_id: str
    size: int


class StartJobRequest(BaseModel):
    options: JobOptions
    upload_id: str | None = None


def _upload_path(upload_id: str):
    if not re.fullmatch(r"[a-f0-9]{12}\.[A-Za-z0-9]{1,6}", upload_id):
        raise HTTPException(400, detail=tr("upload.bad_id"))
    return paths().temp / f"upload_{upload_id}"


@router.put("/uploads/{filename}", response_model=UploadResult)
async def upload(filename: str, request: Request) -> UploadResult:
    suffix = (re.search(r"\.([A-Za-z0-9]{1,6})$", filename) or [None, "mp4"])[1]
    upload_id = f"{uuid.uuid4().hex[:12]}.{suffix}"
    dest = _upload_path(upload_id)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with JobRegistry.uploading():
        size = await receive(request, dest, lambda: remove_file(dest))
    return UploadResult(upload_id=upload_id, size=size)


def _check(media) -> None:
    """Refuse at once (no job, no queue) what the pipeline would fail on: unreadable files, no sound track."""
    try:
        check_input(media)
    except MediaError as e:
        raise HTTPException(400, detail=str(e)) from e


class InspectRequest(BaseModel):
    path: str


class MediaInfo(BaseModel):
    """What the Studio shows for a file on disk before processing (and whether Eco mode can play it as is)."""

    duration_sec: float
    size_mb: float
    has_video: bool
    playback_problem: str = ""  # "" = the app window plays the original as is


@router.post("/media/inspect", response_model=MediaInfo)
def inspect_media(req: InspectRequest) -> MediaInfo:
    path = to_path(req.path)
    if not path.is_file():
        raise HTTPException(400, detail=tr("file.not_found_path", path=path))
    try:
        duration = check_input(path)
    except MediaError as e:
        raise HTTPException(400, detail=str(e)) from e
    return MediaInfo(
        duration_sec=round(duration, 2),
        size_mb=round(path.stat().st_size / 1024 / 1024, 1),
        has_video=probe_video(path) is not None,
        playback_problem=browser_playback_problem(path),
    )


@router.post("/jobs", response_model=Job)
def start_job(req: StartJobRequest) -> Job:
    opts = req.options
    if not Library.get_project(opts.project_id):
        raise HTTPException(400, detail=tr("project.not_found"))
    if req.upload_id:
        media = _upload_path(req.upload_id)
        if not media.is_file():
            raise HTTPException(400, detail=tr("upload.missing"))
        _check(media)
        return start_processing(opts, str(media), is_uploaded=True)
    if opts.local_path:
        media = to_path(opts.local_path)
        if not media.is_file():
            raise HTTPException(400, detail=tr("file.not_found_path", path=media))
        _check(media)
        job = start_processing(opts, str(media), is_uploaded=False)
        videos.mark_used(media)  # a file from the Videos tab is now taken
        return job
    raise HTTPException(400, detail=tr("job.need_file"))


@router.get("/jobs", response_model=list[Job])
def list_jobs() -> list[Job]:
    return JobRegistry.list()


@router.post("/jobs/clear-finished")
def clear_finished() -> dict:
    """Finished jobs leave the Studio's list; the history keeps them."""
    return {"cleared": JobRegistry.clear_finished()}


@router.get("/jobs/history", response_model=JobPage)
def job_history(page: int = 1, size: int = 20) -> JobPage:
    return JobRegistry.history(page, size)


@router.delete("/jobs/history")
def clear_job_history() -> dict:
    JobRegistry.clear_history()
    return {"ok": True}


@router.get("/jobs/stream")
async def stream_jobs(request: Request) -> StreamingResponse:
    """
    SSE: the full job list, pushed whenever anything changes; a `library` event when the MCP server changed
    the library (the app reloads what is open); a heartbeat when nothing happens.
    """

    async def events():
        last, signal, idle = None, Library.change_signal(), 0
        while not await request.is_disconnected():
            sent = False
            payload = json.dumps([j.model_dump() for j in JobRegistry.list()], ensure_ascii=False)
            if payload != last:
                last, sent = payload, True
                yield f"data: {payload}\n\n"
            changed = Library.change_signal()
            if changed != signal:
                signal, sent = changed, True
                yield f"event: library\ndata: {changed}\n\n"
            idle = 0 if sent else idle + 1
            if idle and idle % 30 == 0:
                yield ": ping\n\n"
            await asyncio.sleep(0.5)

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@router.get("/jobs/{job_id}", response_model=Job)
def get_job(job_id: str) -> Job:
    job = JobRegistry.get(job_id)
    if not job:
        raise HTTPException(404, detail=tr("job.not_found"))
    return job


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict:
    if not JobRegistry.request_cancel(job_id):
        raise HTTPException(404, detail=tr("job.active_not_found"))
    return {"ok": True}
