"""
Google Gemini audio engine. Long audio is split into ~20 min chunks; chunk offsets are
measured with ffprobe (not assumed), so timecodes stay on the exact clean timeline.
"""

import json
import logging
import shutil
import time
from pathlib import Path
from typing import Callable, List, Optional, Tuple

from backend.core.ai.prompts import gemini_transcription_instruction
from backend.core.media.base import probe_duration, run_ffmpeg
from backend.core.timeline import parse_tc
from backend.models.transcript import GeminiTranscript

logger = logging.getLogger(__name__)

CHUNK_THRESHOLD_SEC = 1500
CHUNK_SEC = 1200


def _chunks(audio: Path, duration: float, work_dir: Path) -> List[Tuple[Path, float]]:
    if duration <= CHUNK_THRESHOLD_SEC:
        return [(audio, 0.0)]
    work_dir.mkdir(parents=True, exist_ok=True)
    run_ffmpeg(
        ["ffmpeg", "-y", "-i", str(audio), "-f", "segment", "-segment_time", str(CHUNK_SEC), "-c", "copy",
         str(work_dir / "chunk_%03d.mp3")],
        "audio chunking",
    )
    out, offset = [], 0.0
    for f in sorted(work_dir.glob("chunk_*.mp3")):
        out.append((f, offset))
        offset += probe_duration(f)
    return out


def transcribe(
    audio_path: str,
    duration: float,
    api_key: str,
    model: str,
    work_dir: Path,
    language: str = "auto",
    vocabulary: str = "",
    check_cancelled: Callable[[], None] = lambda: None,
    on_progress: Optional[Callable[[float], None]] = None,
) -> List[dict]:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)
    instruction = gemini_transcription_instruction(language, vocabulary)
    chunks = _chunks(Path(audio_path), duration, work_dir)
    out: List[dict] = []

    try:
        for idx, (chunk, offset) in enumerate(chunks):
            check_cancelled()
            uploaded = client.files.upload(file=str(chunk))
            try:
                for _ in range(30):
                    state = getattr(client.files.get(name=uploaded.name).state, "name", "")
                    if state == "ACTIVE":
                        break
                    if state == "FAILED":
                        raise RuntimeError(f"Gemini не принял файл {chunk.name}")
                    check_cancelled()
                    time.sleep(2)

                response = client.models.generate_content(
                    model=model,
                    contents=[uploaded, "Transcribe this audio verbatim with timestamps."],
                    config=types.GenerateContentConfig(
                        system_instruction=instruction,
                        response_mime_type="application/json",
                        response_schema=GeminiTranscript,
                    ),
                )
                for s in json.loads(response.text or "{}").get("segments", []):
                    start = parse_tc(s.get("start_time_mm_ss", "0")) + offset
                    end = parse_tc(s.get("end_time_mm_ss", "0")) + offset
                    out.append({"clean_start": start, "clean_end": max(end, start + 1.0), "text": s.get("text", "")})
            finally:
                try:
                    client.files.delete(name=uploaded.name)
                except Exception as e:  # cloud cleanup is best-effort
                    logger.warning("Gemini file cleanup failed: %s", e)
            if on_progress:
                on_progress((idx + 1) / len(chunks))
    finally:
        if len(chunks) > 1:
            shutil.rmtree(work_dir, ignore_errors=True)
    return out
