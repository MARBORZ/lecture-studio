"""
The Videos tab: search YouTube, show one video, download it for the Studio. Only YouTube for now.

Everything runs through yt-dlp on this computer (a Python dependency, uv.lock), started as `python -m yt_dlp` in a
child process rather than imported: an updated yt-dlp (POST /api/videos/downloader/update; YouTube breaks it often)
is used at once without restarting the server, a cancel stops the process and its ffmpeg, and progress is read line
by line. No Google keys: search is yt-dlp's "ytsearch". Thumbnails and the embedded player load in the browser
straight from YouTube (i.ytimg.com, youtube-nocookie.com); the server only searches and downloads.

A download is a job of its own (kind "download", stage "download") in the common queue and its limit, on a worker of
its own (network, not CPU: it does not wait behind a Whisper job). The file lands in paths().downloads; the Studio
then makes a lesson of it like of any file on disk.
"""

import json
import logging
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from backend.i18n import tr
from backend.models.job import Job
from backend.models.video import DownloadedVideo, DownloaderInfo, DownloadPage, VideoInfo, VideoItem
from backend.services.jobs import JobRegistry
from backend.settings import paths
from backend.utils import proc
from backend.utils.fs import read_json, write_json

logger = logging.getLogger(__name__)

SEARCH_RESULTS = 20
MAX_PAGES = 10  # 200 results: past that YouTube's relevance is noise
MEDIA_EXT = {".mp4", ".m4a", ".webm", ".mkv", ".mov", ".mp3"}
SEARCH_TIMEOUT = 40
INFO_TIMEOUT = 40
# best up to 1080p as mp4 + m4a (merged by ffmpeg), falling back to whatever single file is there
# H.264 first (plays everywhere, edits fast); YouTube also serves VP9 inside mp4
FORMAT = (
    "bv*[height<=1080][ext=mp4][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080][ext=mp4]+ba[ext=m4a]"
    "/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b[height<=1080]/b"
)
_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_HOSTS = {
    "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be",
    "youtube-nocookie.com", "www.youtube-nocookie.com",
}
_PROGRESS = re.compile(r"^LSPROGRESS\s+(\S+)%\s*(\S*)")  # " 5.0%" padded; then the stream's vcodec ("none" = sound)

_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="download")


class VideoError(RuntimeError):
    """For the user, already translated."""


# ---------------------------------------------------------------- yt-dlp


def _cmd(*args: str) -> list[str]:
    return [sys.executable, "-m", "yt_dlp", "--no-warnings", "--ignore-config", *args]


def _explain(stderr: str) -> str:
    """yt-dlp's error as something the user can act on."""
    s = stderr.lower()
    if "confirm your age" in s or "age-restricted" in s or "inappropriate for some users" in s:
        return tr("video.age")
    if "not a bot" in s:
        return tr("video.bot")
    if "private video" in s or "video unavailable" in s or "has been removed" in s or "not available" in s:
        return tr("video.unavailable")
    if "live event will begin" in s or "premieres in" in s or "is live" in s:
        return tr("video.live")
    if any(w in s for w in ("getaddrinfo", "name or service not known", "nodename nor servname", "network is unreachable",
                            "timed out", "connection refused", "connection reset", "unable to download webpage", "failed to resolve")):
        return tr("video.offline")
    if "unsupported url" in s or "is not a valid url" in s:
        return tr("video.bad_url")
    last = next((line for line in reversed(stderr.strip().splitlines()) if line.strip()), "")
    return tr("video.failed", error=last.removeprefix("ERROR: ")[:240])


def _run(args: list[str], timeout: float) -> str:
    try:
        res = subprocess.run(_cmd(*args), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    except subprocess.TimeoutExpired as e:
        raise VideoError(tr("video.offline")) from e
    except OSError as e:
        raise VideoError(tr("video.no_downloader", error=str(e))) from e
    if res.returncode != 0:
        logger.warning("yt-dlp %s failed: %s", args[:1], res.stderr.strip()[-500:])
        raise VideoError(_explain(res.stderr))
    return res.stdout


# ---------------------------------------------------------------- urls


def video_id(url: str) -> str | None:
    """The 11-character id of a YouTube link (watch, youtu.be, shorts, embed, live), or None."""
    raw = url.strip()
    if _ID.match(raw):
        return raw
    parsed = urlparse(raw if "://" in raw else f"https://{raw}")
    if parsed.hostname not in _HOSTS:
        return None
    if parsed.hostname.endswith("youtu.be"):
        candidate = parsed.path.strip("/").split("/")[0]
    elif parsed.path == "/watch":
        candidate = (parse_qs(parsed.query).get("v") or [""])[0]
    else:
        parts = parsed.path.strip("/").split("/")
        candidate = parts[1] if len(parts) > 1 and parts[0] in ("shorts", "embed", "live", "v") else ""
    return candidate if _ID.match(candidate or "") else None


def watch_url(vid: str) -> str:
    return f"https://www.youtube.com/watch?v={vid}"


def thumbnail(vid: str) -> str:
    return f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg"


# ---------------------------------------------------------------- search and details


def _item(e: dict) -> VideoItem | None:
    vid = e.get("id") or ""
    if not _ID.match(vid) or e.get("ie_key", "Youtube") != "Youtube":
        return None  # channels and playlists in the results
    return VideoItem(
        id=vid,
        url=watch_url(vid),
        title=e.get("title") or vid,
        channel=e.get("channel") or e.get("uploader") or "",
        duration=e.get("duration"),
        views=e.get("view_count"),
        thumbnail=thumbnail(vid),
    )


def parse_search(output: str) -> list[VideoItem]:
    data = json.loads(output or "{}")
    return [item for e in data.get("entries") or [] if isinstance(e, dict) and (item := _item(e))]


def search(query: str, page: int = 1) -> list[VideoItem]:
    """One page of results (SEARCH_RESULTS each): page 2 asks YouTube for 40 and keeps items 21–40."""
    q = " ".join(query.split())[:200]
    page = max(1, min(page, MAX_PAGES))
    if not q:
        return []
    start, end = (page - 1) * SEARCH_RESULTS + 1, page * SEARCH_RESULTS
    return parse_search(_run([f"ytsearch{end}:{q}", "--flat-playlist", "--playlist-items", f"{start}-{end}", "-J"], SEARCH_TIMEOUT))


def parse_info(output: str) -> VideoInfo:
    e = json.loads(output)
    vid = e["id"]
    d = e.get("upload_date") or ""
    description = "\n".join((e.get("description") or "").splitlines()[:6])[:600]
    return VideoInfo(
        id=vid,
        url=watch_url(vid),
        title=e.get("title") or vid,
        channel=e.get("channel") or e.get("uploader") or "",
        duration=e.get("duration"),
        views=e.get("view_count"),
        thumbnail=thumbnail(vid),
        upload_date=f"{d[:4]}-{d[4:6]}-{d[6:8]}" if len(d) == 8 else "",
        license=e.get("license") or "",
        description=description,
        age_limit=int(e.get("age_limit") or 0),
        is_live=bool(e.get("is_live")),
    )


def info(url: str) -> VideoInfo:
    vid = video_id(url)
    if not vid:
        raise VideoError(tr("video.bad_url"))
    return parse_info(_run(["-J", "--skip-download", "--no-playlist", watch_url(vid)], INFO_TIMEOUT))


# ---------------------------------------------------------------- download


def start_download(url: str, title: str = "") -> Job:
    vid = video_id(url)
    if not vid:
        raise VideoError(tr("video.bad_url"))
    job = JobRegistry.create("download", title.strip() or tr("video.job_title", id=vid), ["download"])
    _executor.submit(_download, job.id, vid, title.strip())
    return job


def _download(job_id: str, vid: str, title: str) -> None:
    target = paths().downloads
    target.mkdir(parents=True, exist_ok=True)
    JobRegistry.update(job_id, status="processing", stage="download", progress=0, message=tr("video.starting"))
    try:
        path = run_download(vid, target, job_id)
        name = title or path.stem.rsplit(" [", 1)[0]  # "<title> [<id>]"
        JobRegistry.update(job_id, status="completed", stage="done", progress=100, message=tr("video.downloaded"), media_path=str(path), title=name)
    except DownloadCancelled:
        _remove_partial(target, vid)
        JobRegistry.update(job_id, status="cancelled", message=tr("job.cancelled"))
    except Exception as e:
        _remove_partial(target, vid)
        logger.error("[%s] download %s failed: %s", job_id, vid, e)
        JobRegistry.update(job_id, status="error", error=str(e), message=tr("job.failed"))


class DownloadCancelled(Exception):
    pass


def download_cmd(vid: str, target: Path) -> list[str]:
    return _cmd(
        "-f", FORMAT, "--merge-output-format", "mp4", "--no-playlist", "--no-mtime", "--windows-filenames",
        "--progress", "--newline",  # --print implies --quiet, which would hide the progress lines
        "--progress-template", "download:LSPROGRESS %(progress._percent_str)s %(info.vcodec)s",
        "--print", "after_move:LSFILE %(filepath)s",
        "-o", str(target / "%(title).80B [%(id)s].%(ext)s"),
        watch_url(vid),
    )


def run_download(vid: str, target: Path, job_id: str) -> Path:
    """yt-dlp in a child process; its lines move the job's progress, a cancel stops it (with ffmpeg)."""
    p = subprocess.Popen(download_cmd(vid, target), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", bufsize=1)
    lines: queue.Queue[str | None] = queue.Queue()
    err: list[str] = []

    def pump(stream, sink, end=None) -> None:
        for line in stream:
            sink(line.rstrip("\n"))
        if end:
            end()

    threading.Thread(target=pump, args=(p.stdout, lines.put, lambda: lines.put(None)), daemon=True).start()
    err_done = threading.Event()
    threading.Thread(target=pump, args=(p.stderr, err.append, err_done.set), daemon=True).start()

    saved, shown, started = "", 0, set()
    while True:
        if JobRegistry.is_cancel_requested(job_id):
            proc.terminate_tree(p.pid)
            raise DownloadCancelled
        try:
            line = lines.get(timeout=0.3)
        except queue.Empty:
            continue
        if line is None:
            break
        if m := _PROGRESS.match(line):
            try:
                pct = float(m.group(1))
            except ValueError:
                continue
            sound = m.group(2) == "none"  # the separate audio stream comes after the video one
            first = sound not in started
            started.add(sound)
            if first and pct >= 100:
                continue  # a fragmented (HLS) stream opens with a bogus "100%" before its real 0–100 %
            overall = min(95, 80 + pct * 0.15 if sound else pct * 0.8)
            shown = max(shown, int(overall))  # fragmented streams re-estimate their size: the bar never goes back
            label = tr("video.progress_audio" if sound else "video.progress_video", pct=int(pct))
            JobRegistry.update(job_id, progress=shown, message=label)
        elif line.startswith("LSFILE "):
            saved = line[7:].strip()
            JobRegistry.update(job_id, progress=99, message=tr("video.merging"))
    code = p.wait()
    if JobRegistry.is_cancel_requested(job_id):
        raise DownloadCancelled
    err_done.wait(2)  # the rest of stderr, for the error text
    if code != 0 or not saved:
        raise VideoError(_explain("\n".join(err)))
    return Path(saved)


def _remove_partial(target: Path, vid: str) -> None:
    """What a stopped download leaves: .part, .ytdl and the separate streams before merging. A finished file stays."""
    for f in target.glob(f"*[[]{vid}[]]*"):
        if f.suffix in (".part", ".ytdl", ".temp") or re.search(r"\.f\d+\.\w+(\.part)?$", f.name):
            f.unlink(missing_ok=True)


# ---------------------------------------------------------------- the downloader itself

_latest: tuple[float, str] = (0.0, "")


def downloader() -> DownloaderInfo:
    try:
        version = _run(["--version"], 20).strip()
    except VideoError:
        version = ""
    latest = _pypi_latest()
    newer = bool(version and latest and _vkey(latest) > _vkey(version))
    return DownloaderInfo(version=version, latest=latest, update_available=newer)


def _vkey(v: str) -> tuple[int, ...]:
    return tuple(int(x) for x in re.findall(r"\d+", v))


def _pypi_latest() -> str:
    """The newest yt-dlp on PyPI, cached for an hour; "" when offline."""
    global _latest
    if time.time() - _latest[0] < 3600 and _latest[1]:
        return _latest[1]
    try:
        req = urllib.request.Request("https://pypi.org/pypi/yt-dlp/json", headers={"User-Agent": "lecture-studio"})
        with urllib.request.urlopen(req, timeout=8) as res:
            _latest = (time.time(), str(json.load(res)["info"]["version"]))
    except (OSError, ValueError, KeyError):
        return ""
    return _latest[1]


def update_downloader() -> DownloaderInfo:
    """The newest yt-dlp into this app's environment (uv). A later release's `uv sync` sets the version of its lock."""
    if any(j.kind == "download" for j in JobRegistry.active()):
        raise VideoError(tr("video.update_busy"))
    uv = shutil.which("uv") or next((str(p) for p in (Path.home() / ".local" / "bin" / "uv", Path.home() / ".local" / "bin" / "uv.exe") if p.exists()), None)
    if not uv:
        raise VideoError(tr("video.update_no_uv"))
    cmd = [uv, "pip", "install", "--upgrade", "yt-dlp", "--python", sys.executable]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300)
    if res.returncode != 0:
        logger.warning("yt-dlp update failed: %s", res.stderr[-500:])
        raise VideoError(tr("video.update_failed", error=(res.stderr.strip().splitlines() or [""])[-1][:200]))
    global _latest
    _latest = (0.0, "")
    return downloader()


# ---------------------------------------------------------------- downloads/


def _used_file() -> Path:
    return paths().downloads / ".used.json"


def mark_used(path: Path | str) -> None:
    """A Studio job took this downloaded file: it moves from "not used yet" to the rest."""
    p = Path(path).resolve()
    root = paths().downloads.resolve()
    if root not in p.parents:
        return
    used = read_json(_used_file(), [])
    if p.name not in used:
        write_json(_used_file(), [*used, p.name])


def list_downloads(page: int = 1, size: int = 20, unused_only: bool = False) -> DownloadPage:
    """Files the Videos tab downloaded, newest first; the title comes from the file name ("Title [id].mp4")."""
    root = paths().downloads
    used = set(read_json(_used_file(), []))
    found = [f for f in root.iterdir() if f.is_file() and f.suffix.lower() in MEDIA_EXT] if root.is_dir() else []
    files = sorted(found, key=lambda f: f.stat().st_mtime, reverse=True)
    items = [
        DownloadedVideo(
            name=f.name,
            path=str(f),
            title=re.sub(r"\s*\[[A-Za-z0-9_-]{11}\]$", "", f.stem) or f.stem,
            size_mb=round(f.stat().st_size / 1024 / 1024, 1),
            downloaded_at=datetime.fromtimestamp(f.stat().st_mtime).isoformat(timespec="seconds"),
            used=f.name in used,
        )
        for f in files
    ]
    if unused_only:
        items = [i for i in items if not i.used]
    size = max(1, min(size, 100))
    page = max(1, page)
    start = (page - 1) * size
    return DownloadPage(items=items[start : start + size], total=len(items), page=page, size=size)


def delete_download(name: str) -> bool:
    """Remove one downloaded file (a lesson made of it keeps its own copy)."""
    target = paths().downloads / Path(name).name
    if not target.is_file() or target.suffix.lower() not in MEDIA_EXT:
        return False
    target.unlink()
    used = read_json(_used_file(), [])
    if target.name in used:
        write_json(_used_file(), [u for u in used if u != target.name])
    return True
