"""
The Videos tab: YouTube search, one video's details, download into the queue, the downloader's version and update.
"""

from fastapi import APIRouter, HTTPException

from backend.i18n import tr
from backend.models.job import Job
from backend.models.video import DownloaderInfo, DownloadRequest, VideoInfo, VideoItem
from backend.services import videos
from backend.settings import SettingsService

router = APIRouter(prefix="/api/videos", tags=["videos"])


def _fail(e: videos.VideoError) -> HTTPException:
    return HTTPException(502, detail=str(e))


@router.get("/search", response_model=list[VideoItem])
def search(q: str) -> list[VideoItem]:
    try:
        return videos.search(q)
    except videos.VideoError as e:
        raise _fail(e) from e


@router.get("/info", response_model=VideoInfo)
def info(url: str) -> VideoInfo:
    try:
        return videos.info(url)
    except videos.VideoError as e:
        raise _fail(e) from e


@router.post("/download", response_model=Job)
def download(req: DownloadRequest) -> Job:
    """Queued like any job (QueueFull: 429). Refused until the user accepted the one-time rights notice."""
    if not SettingsService.get().video_terms_accepted:
        raise HTTPException(409, detail={"message": tr("video.terms_needed"), "code": "terms"})
    try:
        return videos.start_download(req.url, req.title)
    except videos.VideoError as e:
        raise HTTPException(400, detail=str(e)) from e


@router.get("/downloader", response_model=DownloaderInfo)
def downloader() -> DownloaderInfo:
    return videos.downloader()


@router.post("/downloader/update", response_model=DownloaderInfo)
def update_downloader() -> DownloaderInfo:
    try:
        return videos.update_downloader()
    except videos.VideoError as e:
        raise HTTPException(409, detail=str(e)) from e
