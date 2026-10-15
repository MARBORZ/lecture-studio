"""
The single time module of Lecture Studio.

Two timelines exist for every lesson:
  * clean — the silence-cut timeline. clean_speech.mp3 and clean_video.mp4 play on it.
            Every timecode shown in the UI or written into an audit uses this timeline.
  * orig  — the original recording (OBS) timeline. Informational only.

TimeMap converts between them. Segment boundaries are snapped to the video frame grid
before cutting, so the audio and video clean timelines are identical.
"""

import bisect
import re
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from typing import Any

# [MM:SS] or [H:MM:SS] / [HH:MM:SS], optionally wrapped in a `code span` (unwrapped on rewrite)
TIMECODE_RE = re.compile(r"(`?)\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\1")
_SRT_TIME_RE = re.compile(r"(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})")

Span = tuple[float, float]


# ---------------- formatting / parsing ----------------

def format_tc(seconds: float) -> str:
    """12.7 -> '00:12', 3725 -> '01:02:05'."""
    total = int(max(0.0, float(seconds)))
    h, m, s = total // 3600, (total % 3600) // 60, total % 60
    return f"{h:02d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def format_srt(seconds: float) -> str:
    """12.345 -> '00:00:12,345'."""
    ms_total = int(round(max(0.0, float(seconds)) * 1000))
    h, rem = divmod(ms_total, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def parse_tc(value: str) -> float:
    """'MM:SS', 'HH:MM:SS', 'SS(.sss)', '00:00:01,500' -> seconds."""
    value = value.strip().strip("[]").replace(",", ".")
    parts = value.split(":")
    try:
        nums = [float(p) for p in parts]
    except ValueError:
        found = re.findall(r"\d+(?:\.\d+)?", value)
        return float(found[0]) if found else 0.0
    seconds = 0.0
    for n in nums:
        seconds = seconds * 60 + n
    return seconds


def _tc_match_seconds(m: re.Match) -> float:
    a, b, c = m.group(2), m.group(3), m.group(4)
    return int(a) * 3600 + int(b) * 60 + int(c) if c is not None else int(a) * 60 + int(b)


# ---------------- segments ----------------

def frame_snap(spans: Sequence[Span], fps: float | None, duration: float | None = None) -> list[Span]:
    """Round span boundaries to the nearest video frame so audio and video cut identically."""
    if not fps or fps <= 0:
        return [(round(s, 3), round(e, 3)) for s, e in spans]
    frame = 1.0 / fps
    out: list[Span] = []
    for s, e in spans:
        s2 = round(round(s / frame) * frame, 6)
        e2 = round(round(e / frame) * frame, 6)
        if duration is not None:
            e2 = min(e2, duration)
        if out and s2 < out[-1][1]:
            s2 = out[-1][1]
        if e2 - s2 >= frame:
            out.append((s2, e2))
    return out


@dataclass(frozen=True)
class MapEntry:
    orig_start: float
    orig_end: float
    clean_start: float
    clean_end: float


class TimeMap:
    """clean <-> orig conversion over the list of kept speech spans (time_map.json)."""

    def __init__(self, entries: Iterable[dict[str, Any]]):
        self.entries: list[MapEntry] = [
            MapEntry(float(e["orig_start"]), float(e["orig_end"]), float(e["clean_start"]), float(e["clean_end"]))
            for e in entries
        ]
        self._clean_starts = [e.clean_start for e in self.entries]
        self._orig_starts = [e.orig_start for e in self.entries]

    def __bool__(self) -> bool:
        return bool(self.entries)

    @property
    def clean_duration(self) -> float:
        return self.entries[-1].clean_end if self.entries else 0.0

    @property
    def orig_duration(self) -> float:
        return self.entries[-1].orig_end if self.entries else 0.0

    def clean_to_orig(self, t: float) -> float:
        if not self.entries:
            return t
        i = max(0, bisect.bisect_right(self._clean_starts, t) - 1)
        e = self.entries[i]
        return round(min(e.orig_start + max(0.0, t - e.clean_start), e.orig_end), 3)

    def orig_to_clean(self, t: float) -> float:
        """A point inside a cut pause maps to the cut point (start of the next kept span)."""
        if not self.entries:
            return t
        i = bisect.bisect_right(self._orig_starts, t) - 1
        if i < 0:
            return 0.0
        e = self.entries[i]
        if t <= e.orig_end:
            return round(e.clean_start + (t - e.orig_start), 3)
        return round(e.clean_end, 3)

    @staticmethod
    def build(spans: Sequence[Span], clean_lengths: Sequence[float] | None = None) -> list[dict[str, float]]:
        """time_map.json payload for kept spans laid end-to-end."""
        out: list[dict[str, float]] = []
        cursor = 0.0
        for idx, (s, e) in enumerate(spans):
            length = clean_lengths[idx] if clean_lengths else (e - s)
            out.append({
                "segment_index": idx,
                "orig_start": round(s, 3),
                "orig_end": round(e, 3),
                "clean_start": round(cursor, 3),
                "clean_end": round(cursor + length, 3),
            })
            cursor += length
        return out


# ---------------- SRT ----------------

def parse_srt(text: str) -> list[dict[str, Any]]:
    """SRT text -> [{start, end, text}] (seconds)."""
    items: list[dict[str, Any]] = []
    for block in re.split(r"\n\s*\n", text.strip()):
        lines = [l for l in block.strip().splitlines() if l.strip()]
        arrow = next((i for i, l in enumerate(lines) if "-->" in l), None)
        if arrow is None:
            continue
        times = _SRT_TIME_RE.findall(lines[arrow])
        if len(times) < 2:
            continue
        start, end = (int(h) * 3600 + int(m) * 60 + int(s) + int(ms.ljust(3, "0")) / 1000 for h, m, s, ms in times[:2])
        body = " ".join(lines[arrow + 1:]).strip()
        if body:
            items.append({"start": start, "end": end, "text": body})
    return items


# ---------------- timecodes inside text ----------------

def rewrite_timecodes(text: str, transform: Callable[[float], float | None]) -> str:
    """Apply transform to every [MM:SS]/[HH:MM:SS]; None removes the timecode."""

    def repl(m: re.Match) -> str:
        new = transform(_tc_match_seconds(m))
        return "\x00" if new is None else f"[{format_tc(new)}]"

    return re.sub(r"[ \t]?\x00", "", TIMECODE_RE.sub(repl, text))


def normalize_timecodes(text: str, duration: float | None) -> str:
    """Canonical format; drop timecodes beyond the clean duration (model hallucinations)."""
    limit = (duration + 1.0) if duration else None
    return rewrite_timecodes(text, lambda t: None if (limit is not None and t > limit) else t)


def timecodes_in(text: str) -> list[float]:
    return [_tc_match_seconds(m) for m in TIMECODE_RE.finditer(text)]
