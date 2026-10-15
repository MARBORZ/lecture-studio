"""
segments.json is the canonical transcript. Every other transcript file is derived here.
"""

from pathlib import Path
from typing import Iterable, List

from backend.core.timeline import TimeMap, format_srt, format_tc
from backend.models.transcript import Segment
from backend.services.storage import Artifacts
from backend.utils.fs import read_json, write_json, write_text


def segments_from_clean(raw: Iterable[dict], time_map: TimeMap) -> List[Segment]:
    """Engine output on the clean timeline -> Segments with orig times attached."""
    out: List[Segment] = []
    for r in raw:
        text = str(r.get("text", "")).strip()
        if not text:
            continue
        cs, ce = round(float(r["clean_start"]), 3), round(float(r["clean_end"]), 3)
        if ce <= cs:
            ce = cs + 1.0
        out.append(Segment(
            clean_start=cs,
            clean_end=ce,
            orig_start=time_map.clean_to_orig(cs),
            orig_end=time_map.clean_to_orig(ce),
            text=text,
        ))
    return out


def write_transcripts(lesson_dir: Path, segments: List[Segment]) -> None:
    """segments.json + plain txt, [MM:SS] txt on both timelines, SRT on both timelines."""
    plain, clean_ts, orig_ts, clean_srt, orig_srt = [], [], [], [], []
    for i, s in enumerate(segments, start=1):
        plain.append(s.text)
        clean_ts.append(f"[{format_tc(s.clean_start)}] {s.text}")
        orig_ts.append(f"[{format_tc(s.orig_start)}] {s.text}")
        clean_srt.append(f"{i}\n{format_srt(s.clean_start)} --> {format_srt(s.clean_end)}\n{s.text}\n")
        orig_srt.append(f"{i}\n{format_srt(s.orig_start)} --> {format_srt(s.orig_end)}\n{s.text}\n")

    write_json(lesson_dir / Artifacts.SEGMENTS, [s.model_dump() for s in segments])
    write_text(lesson_dir / Artifacts.PLAIN, "\n\n".join(plain) + "\n")
    write_text(lesson_dir / Artifacts.CLEAN_TS, "\n".join(clean_ts) + "\n")
    write_text(lesson_dir / Artifacts.ORIG_TS, "\n".join(orig_ts) + "\n")
    write_text(lesson_dir / Artifacts.CLEAN_SRT, "\n".join(clean_srt))
    write_text(lesson_dir / Artifacts.ORIG_SRT, "\n".join(orig_srt))


def load_segments(lesson_dir: Path) -> List[Segment]:
    return [Segment(**s) for s in (read_json(lesson_dir / Artifacts.SEGMENTS, default=[]) or [])]


def compact_transcript(segments: List[Segment]) -> str:
    """AI input: one '[MM:SS] text' line per phrase on the clean timeline."""
    return "\n".join(f"[{format_tc(s.clean_start)}] {s.text}" for s in segments)
