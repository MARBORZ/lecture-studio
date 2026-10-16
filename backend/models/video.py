"""
The Videos tab: YouTube search results, one video's details, a download request, the downloader's version.
"""

from pydantic import BaseModel


class VideoItem(BaseModel):
    id: str
    url: str
    title: str
    channel: str = ""
    duration: float | None = None  # seconds; None for a live stream
    views: int | None = None
    thumbnail: str = ""  # i.ytimg.com, loaded by the browser directly


class VideoInfo(VideoItem):
    upload_date: str = ""  # YYYY-MM-DD
    license: str = ""  # e.g. "Creative Commons Attribution license (reuse allowed)"
    description: str = ""  # the first lines
    age_limit: int = 0
    is_live: bool = False


class DownloadRequest(BaseModel):
    url: str
    title: str = ""  # the lesson title the Studio starts with; "" = the video's title


class DownloaderInfo(BaseModel):
    version: str  # "" when yt-dlp does not run
    latest: str = ""  # from PyPI; "" when unknown (offline)
    update_available: bool = False


class DownloadedVideo(BaseModel):
    """A file in downloads/: what the Videos tab fetched, and whether a lesson was made of it."""

    name: str
    path: str
    title: str
    size_mb: float
    downloaded_at: str
    used: bool = False  # a Studio job took it


class DownloadPage(BaseModel):
    items: list[DownloadedVideo]
    total: int
    page: int
    size: int
