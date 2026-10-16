"""
Shared FFmpeg plumbing and the BaseMediaProcessor contract.
"""

import json
import logging
import shutil
import subprocess
from abc import ABC, abstractmethod
from collections.abc import Sequence
from functools import lru_cache
from typing import Any

from backend.i18n import tr
from backend.utils.fs import PathLike

logger = logging.getLogger(__name__)

Span = tuple[float, float]


@lru_cache(maxsize=1)
def ffmpeg_available() -> bool:
    return bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


@lru_cache(maxsize=8)
def has_encoder(name: str) -> bool:
    """Whether this FFmpeg build has an encoder (e.g. h264_nvenc: present in Gyan/BtbN builds, absent in some others)."""
    if not ffmpeg_available():
        return False
    proc = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True, encoding="utf-8", errors="replace")
    return any(line.split()[1:2] == [name] for line in proc.stdout.splitlines() if line.strip())


def verify_ffmpeg() -> None:
    if not ffmpeg_available():
        raise RuntimeError(tr("media.no_ffmpeg"))


class MediaError(ValueError):
    """The input cannot be processed; the message is for the user."""


def run_ffmpeg(cmd: list[str], desc: str) -> None:
    """Errors only on stderr (no banner, no stats): a failure message is the reason, not the tail of a progress log."""
    verify_ffmpeg()
    if cmd and cmd[0] == "ffmpeg":
        cmd = [cmd[0], "-hide_banner", "-nostats", "-loglevel", "error", *cmd[1:]]
    proc = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        lines = [line.strip() for line in (proc.stderr or "").splitlines() if line.strip()]
        raise RuntimeError(tr("media.ffmpeg_failed", what=desc, detail=" | ".join(lines[-4:])[-500:] or tr("media.exit_code", code=proc.returncode)))


def check_input(path: PathLike) -> float:
    """Before a job starts: the file must be readable media with a sound track. Returns the duration.
    Common failure: a stream downloaded from YouTube ("videoplayback") carries video only — sound is a separate file."""
    try:
        data = ffprobe_json(path, "-show_entries", "stream=codec_type:format=duration")
    except RuntimeError as e:
        raise MediaError(tr("media.unreadable", error=e)) from e
    kinds = {s.get("codec_type") for s in data.get("streams", [])}
    if "audio" not in kinds:
        hint = tr("media.youtube_hint") if "video" in kinds else ""
        raise MediaError(tr("media.no_audio", hint=hint))
    return float(data.get("format", {}).get("duration") or 0.0)


def ffprobe_json(path: PathLike, *args: str) -> dict[str, Any]:
    verify_ffmpeg()
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-of", "json", *args, str(path)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffprobe: {proc.stderr.strip()[-300:]}")
    return json.loads(proc.stdout or "{}")


def probe_duration(path: PathLike) -> float:
    data = ffprobe_json(path, "-show_entries", "format=duration")
    return float(data.get("format", {}).get("duration") or 0.0)


def savings_percent(orig: float, clean: float) -> float:
    return round((orig - clean) / orig * 100.0, 1) if orig > 0 else 0.0


class BaseMediaProcessor(ABC):
    """
    Contract for processors that cut media by speech spans.
    normalize_spans() duck-types any span shape: dicts, objects with .start/.end, tuples.
    Spans are always in seconds.
    """

    @staticmethod
    def normalize_spans(spans: Sequence[Any], min_dur: float = 0.04) -> list[Span]:
        out: list[Span] = []
        for s in spans:
            if isinstance(s, dict):
                a, b = s.get("start", 0), s.get("end", 0)
            elif hasattr(s, "start") and hasattr(s, "end"):
                a, b = s.start, s.end
            elif isinstance(s, (tuple, list)) and len(s) >= 2:
                a, b = s[0], s[1]
            else:
                continue
            a, b = float(a), float(b)
            if b - a >= min_dur:
                out.append((a, b))
        return out

    @abstractmethod
    def process(self, input_path: PathLike, output_path: PathLike, spans: Sequence[Any], **kwargs: Any) -> dict[str, Any]:
        """Cut input by spans into output; return stats."""
