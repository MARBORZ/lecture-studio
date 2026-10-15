"""
Local Faster-Whisper engine. Returns phrases on the clean timeline.
"""

import logging
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

# PyAV 14+ dropped the metadata_errors kwarg that faster-whisper still passes.
try:
    import av

    _orig_open = av.open

    def _open(*args, **kwargs):
        kwargs.pop("metadata_errors", None)
        return _orig_open(*args, **kwargs)

    av.open = _open
except ImportError:
    pass

_models: Dict[str, Any] = {}


def _model(size: str):
    if size not in _models:
        import torch
        from faster_whisper import WhisperModel

        device, compute = ("cuda", "float16") if torch.cuda.is_available() else ("cpu", "int8")
        logger.info("Loading Faster-Whisper %s on %s (%s)", size, device, compute)
        _models[size] = WhisperModel(size, device=device, compute_type=compute, cpu_threads=4)
    return _models[size]


def transcribe(
    audio_path: str,
    duration: float,
    model_size: str,
    language: str = "auto",
    vocabulary: str = "",
    check_cancelled: Callable[[], None] = lambda: None,
    on_progress: Optional[Callable[[float], None]] = None,
) -> List[dict]:
    kwargs: Dict[str, Any] = {"beam_size": 5, "vad_filter": False}  # Silero already removed silence
    if language and language != "auto":
        kwargs["language"] = language
    if vocabulary.strip():
        kwargs["initial_prompt"] = vocabulary.strip()

    segments, _info = _model(model_size).transcribe(audio_path, **kwargs)
    out: List[dict] = []
    for seg in segments:
        check_cancelled()
        out.append({"clean_start": seg.start, "clean_end": seg.end, "text": seg.text})
        if on_progress and duration > 0:
            on_progress(min(1.0, seg.end / duration))
    return out
