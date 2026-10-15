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

from backend.utils.fs import PathLike

logger = logging.getLogger(__name__)

Span = tuple[float, float]


@lru_cache(maxsize=1)
def ffmpeg_available() -> bool:
    return bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


def verify_ffmpeg() -> None:
    if not ffmpeg_available():
        raise RuntimeError("FFmpeg/FFprobe не найдены в PATH. Установите: brew install ffmpeg")


def run_ffmpeg(cmd: list[str], desc: str) -> None:
    verify_ffmpeg()
    proc = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"FFmpeg ({desc}): {(proc.stderr or '').strip()[-600:]}")


def ffprobe_json(path: PathLike, *args: str) -> dict[str, Any]:
    verify_ffmpeg()
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-of", "json", *args, str(path)],
        capture_output=True, text=True,
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
