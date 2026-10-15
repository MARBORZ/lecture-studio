"""
Audio extraction and the silence-cut clean MP3 (5 ms equal-power micro-fades at every cut).
"""

import logging
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf

from backend.core.media.base import BaseMediaProcessor, PathLike, probe_duration, run_ffmpeg
from backend.core.timeline import TimeMap
from backend.utils.fs import remove_file

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16000

# Highpass 80 Hz + gentle compression + loudness normalisation for OBS voice tracks.
ENHANCE_FILTER = "highpass=f=80,acompressor=threshold=-21dB:ratio=3:attack=5:release=50,loudnorm=I=-16:TP=-1.5:LRA=11"


def extract_wav(input_path: PathLike, wav_path: PathLike, enhance: bool = False) -> float:
    """Media -> 16 kHz mono PCM WAV. Returns duration in seconds."""
    Path(wav_path).parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-y", "-i", str(input_path), "-vn"]
    if enhance:
        cmd += ["-af", ENHANCE_FILTER]
    cmd += ["-acodec", "pcm_s16le", "-ar", str(SAMPLE_RATE), "-ac", "1", str(wav_path)]
    run_ffmpeg(cmd, "audio extraction")
    return probe_duration(wav_path)


class AudioProcessor(BaseMediaProcessor):
    def __init__(self, sample_rate: int = SAMPLE_RATE, fade_ms: int = 5, bitrate: str = "128k"):
        self.sample_rate = sample_rate
        self.fade_ms = fade_ms
        self.bitrate = bitrate

    def process(self, input_path: PathLike, output_path: PathLike, spans: Sequence[Any], **kwargs: Any) -> dict[str, Any]:
        """
        Slice spans out of the WAV, fade the edges, encode MP3.
        Returns time_map entries computed from the exact sample counts written.
        """
        raw, _ = sf.read(str(input_path), dtype="float32")
        if raw.ndim > 1:
            raw = raw.mean(axis=1)
        total = len(raw)
        orig_duration = total / self.sample_rate

        valid = self.normalize_spans(spans) or [(0.0, orig_duration)]
        fade = int(self.sample_rate * self.fade_ms / 1000)
        ramp = np.linspace(0, np.pi / 2, fade) if fade else None

        chunks, kept, lengths = [], [], []
        for s, e in valid:
            a, b = max(0, round(s * self.sample_rate)), min(total, round(e * self.sample_rate))
            if b <= a:
                continue
            chunk = raw[a:b].copy()
            if ramp is not None and len(chunk) >= 2 * fade:
                chunk[:fade] *= np.sin(ramp)
                chunk[-fade:] *= np.cos(ramp)
            chunks.append(chunk)
            kept.append((a / self.sample_rate, b / self.sample_rate))
            lengths.append(len(chunk) / self.sample_rate)

        clean = np.concatenate(chunks) if chunks else raw
        tmp_wav = Path(output_path).with_suffix(".tmp.wav")
        sf.write(str(tmp_wav), clean, self.sample_rate, format="WAV", subtype="PCM_16")
        try:
            run_ffmpeg(
                ["ffmpeg", "-y", "-i", str(tmp_wav), "-c:a", "libmp3lame", "-b:a", self.bitrate, str(output_path)],
                "MP3 encoding",
            )
        finally:
            remove_file(tmp_wav)

        time_map = TimeMap.build(kept, lengths)
        return {
            "orig_duration_sec": round(orig_duration, 3),
            "clean_duration_sec": round(len(clean) / self.sample_rate, 3),
            "time_map": time_map,
        }
