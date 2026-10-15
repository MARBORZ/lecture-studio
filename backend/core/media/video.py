"""
Jump-cut video: the same speech spans as the audio, cut in one filtergraph and
compressed with H.264 CRF (+faststart for instant seeking in the browser).
"""

import logging
from collections.abc import Sequence
from typing import Any

from backend.core.media.base import BaseMediaProcessor, PathLike, ffprobe_json, probe_duration, run_ffmpeg, savings_percent
from backend.utils.fs import file_size_mb

logger = logging.getLogger(__name__)

_ART_CODECS = {"mjpeg", "png", "bmp", "gif"}
_SCALE = {"1080p": "scale='min(1920,iw)':-2", "720p": "scale='min(1280,iw)':-2"}


def probe_video(path: PathLike) -> float | None:
    """FPS of the first real video stream, or None (no video / cover art only)."""
    try:
        data = ffprobe_json(path, "-select_streams", "v:0", "-show_entries", "stream=codec_name,avg_frame_rate,r_frame_rate:stream_disposition=attached_pic")
    except RuntimeError:
        return None
    streams = data.get("streams") or []
    if not streams:
        return None
    st = streams[0]
    if st.get("codec_name") in _ART_CODECS or (st.get("disposition") or {}).get("attached_pic"):
        return None
    for key in ("avg_frame_rate", "r_frame_rate"):
        num, _, den = (st.get(key) or "0/0").partition("/")
        if den and float(den) > 0 and float(num) > 0:
            return float(num) / float(den)
    return None


class VideoProcessor(BaseMediaProcessor):
    def __init__(self, crf: int = 26, resolution: str = "1080p", preset: str = "fast"):
        self.crf = crf
        self.resolution = resolution
        self.preset = preset

    def _encode_args(self) -> list:
        return [
            "-c:v", "libx264", "-crf", str(self.crf), "-preset", self.preset, "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", "-c:a", "aac", "-b:a", "128k",
        ]

    def process(self, input_path: PathLike, output_path: PathLike, spans: Sequence[Any], **kwargs: Any) -> dict[str, Any]:
        valid = self.normalize_spans(spans)
        scale = _SCALE.get(self.resolution)

        if not valid:
            cmd = ["ffmpeg", "-y", "-i", str(input_path)] + (["-vf", scale] if scale else []) + self._encode_args() + [str(output_path)]
            run_ffmpeg(cmd, "video compression")
        else:
            parts, concat = [], []
            for i, (s, e) in enumerate(valid):
                fade = min(0.005, (e - s) / 4)
                parts.append(f"[0:v]trim=start={s:.6f}:end={e:.6f},setpts=PTS-STARTPTS[v{i}]")
                parts.append(
                    f"[0:a]atrim=start={s:.6f}:end={e:.6f},asetpts=PTS-STARTPTS,"
                    f"afade=t=in:d={fade:.3f},afade=t=out:st={max(0.0, e - s - fade):.6f}:d={fade:.3f}[a{i}]"
                )
                concat.append(f"[v{i}][a{i}]")
            graph = "; ".join(parts) + "; " + "".join(concat) + f"concat=n={len(valid)}:v=1:a=1[catv][cata]"
            graph += f"; [catv]{scale or 'null'}[outv]; [cata]aformat=channel_layouts=mono|stereo[outa]"
            cmd = ["ffmpeg", "-y", "-i", str(input_path), "-filter_complex", graph, "-map", "[outv]", "-map", "[outa]"]
            logger.info("Jump-cut: %d spans, CRF %s, %s", len(valid), self.crf, self.resolution)
            run_ffmpeg(cmd + self._encode_args() + [str(output_path)], "video jump-cut")

        orig_mb, clean_mb = file_size_mb(input_path), file_size_mb(output_path)
        return {
            "orig_size_mb": orig_mb,
            "clean_size_mb": clean_mb,
            "saved_percent": savings_percent(orig_mb, clean_mb),
            "duration_sec": probe_duration(output_path),
        }
