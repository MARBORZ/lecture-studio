"""
Jump-cut video: the same speech spans as the audio, cut in one filtergraph and
compressed with H.264 (+faststart for instant seeking in the browser).

Encoders:
  x264  — libx264 CRF on the CPU: the default, and the fallback.
  nvenc — h264_nvenc on an NVIDIA GPU (constant quality, spatial/temporal adaptive quantization to keep small text
          readable). Several times faster on Windows laptops; files somewhat larger at the same quality.
          Any NVENC failure (old driver, busy GPU, missing in this FFmpeg build) re-encodes with x264.
The Apple GPU encoder (h264_videotoolbox) is deliberately not used: measured on an M-series Mac it was not faster than
x264 and gave 6-9x larger files at the same SSIM on screen recordings.
"""

import logging
from collections.abc import Sequence
from typing import Any, Literal

from backend.core.media.base import BaseMediaProcessor, PathLike, ffprobe_json, has_encoder, probe_duration, run_ffmpeg, savings_percent
from backend.i18n import tr
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


# What Chromium (the app window) plays without help. Anything else in "original" mode gets a warning.
_PLAYABLE_CONTAINERS = {"mov,mp4,m4a,3gp,3g2,mj2", "matroska,webm", "mp3", "ogg", "wav", "flac"}
_PLAYABLE_VIDEO = {"h264", "vp8", "vp9", "av1"}
_PLAYABLE_AUDIO = {"aac", "mp3", "opus", "vorbis", "flac", "pcm_s16le", "pcm_s24le", "pcm_f32le"}


def browser_playback_problem(path: PathLike) -> str:
    """"" if the app window can play the file as is, else a short reason (container or codec)."""
    try:
        data = ffprobe_json(path, "-show_entries", "format=format_name:stream=codec_type,codec_name")
    except RuntimeError as e:
        return str(e)[:120]
    container = data.get("format", {}).get("format_name", "")
    if container not in _PLAYABLE_CONTAINERS:
        return tr("media.container", name=container)
    for st in data.get("streams", []):
        kind, codec = st.get("codec_type"), st.get("codec_name", "")
        if kind == "video" and codec not in _PLAYABLE_VIDEO and codec not in ("mjpeg", "png"):
            return tr("media.video_codec", name=codec)
        if kind == "audio" and codec not in _PLAYABLE_AUDIO:
            return tr("media.audio_codec", name=codec)
    return ""


def make_analysis_proxy(src: PathLike, dst: PathLike) -> PathLike:
    """A light copy for a cloud model to watch: 480p, 1 frame per second (what Gemini samples anyway), quiet mono
    speech. An hour of screen recording becomes tens of MB instead of gigabytes; timing is unchanged."""
    run_ffmpeg(
        ["ffmpeg", "-y", "-i", str(src), "-vf", "fps=1,scale=-2:'min(480,ih)'", "-c:v", "libx264", "-crf", "30", "-preset", "veryfast",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "32k", "-ac", "1", "-movflags", "+faststart", str(dst)],
        "video for analysis",
    )
    return dst


Encoder = Literal["x264", "nvenc"]


def pick_encoder(gpu_backend: str) -> Encoder:
    """NVENC when the compute plan runs on CUDA and this FFmpeg has it; x264 otherwise."""
    return "nvenc" if gpu_backend == "cuda" and has_encoder("h264_nvenc") else "x264"


class VideoProcessor(BaseMediaProcessor):
    def __init__(self, crf: int = 26, resolution: str = "1080p", preset: str = "fast", encoder: Encoder = "x264"):
        self.crf = crf
        self.resolution = resolution
        self.preset = preset
        self.encoder: Encoder = encoder

    def _encode_args(self, encoder: Encoder | None = None) -> list:
        common = ["-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "128k"]
        if (encoder or self.encoder) == "nvenc":
            # constant quality (cq ~ the CRF number), no bitrate cap; AQ spends bits on fine detail such as code text
            return [
                "-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq", str(self.crf), "-b:v", "0",
                "-spatial-aq", "1", "-temporal-aq", "1", *common,
            ]
        return ["-c:v", "libx264", "-crf", str(self.crf), "-preset", self.preset, *common]

    def process(self, input_path: PathLike, output_path: PathLike, spans: Sequence[Any], **kwargs: Any) -> dict[str, Any]:
        """Encode with the chosen encoder; NVENC failures fall back to x264. Stats say which one made the file."""
        try:
            stats = self._process(input_path, output_path, spans, self.encoder)
        except RuntimeError as e:
            if self.encoder == "x264":
                raise
            logger.warning("NVENC failed, re-encoding with x264: %s", e)
            stats = self._process(input_path, output_path, spans, "x264")
        return stats

    def _process(self, input_path: PathLike, output_path: PathLike, spans: Sequence[Any], encoder: Encoder) -> dict[str, Any]:
        valid = self.normalize_spans(spans)
        scale = _SCALE.get(self.resolution)

        if not valid:
            cmd = ["ffmpeg", "-y", "-i", str(input_path)] + (["-vf", scale] if scale else []) + self._encode_args(encoder) + [str(output_path)]
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
            logger.info("Jump-cut: %d spans, %s quality %s, %s", len(valid), encoder, self.crf, self.resolution)
            run_ffmpeg(cmd + self._encode_args(encoder) + [str(output_path)], "video jump-cut")

        orig_mb, clean_mb = file_size_mb(input_path), file_size_mb(output_path)
        return {
            "orig_size_mb": orig_mb,
            "clean_size_mb": clean_mb,
            "saved_percent": savings_percent(orig_mb, clean_mb),
            "duration_sec": probe_duration(output_path),
            "encoder": encoder,
        }
