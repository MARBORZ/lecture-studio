"""
Local Faster-Whisper engine. Returns phrases on the clean timeline.
"""

import logging
import os
import sys
from collections.abc import Callable
from typing import Any

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

_models: dict[str, Any] = {}
_dll_dirs: list[Any] = []  # handles of os.add_dll_directory(): dropping one removes the directory from the search path
_device: dict[str, str] = {}


def _use_torch_cuda_libs(torch) -> None:
    """Windows: CTranslate2 loads cuBLAS/cuDNN from the DLL search path, while the CUDA build of torch ships them in
    torch/lib. Point one at the other (before faster_whisper imports ctranslate2), so no separate NVIDIA install is needed."""
    if sys.platform != "win32" or _dll_dirs:
        return
    lib = os.path.join(os.path.dirname(torch.__file__), "lib")
    if os.path.isdir(lib):
        _dll_dirs.append(os.add_dll_directory(lib))


def device() -> dict[str, str]:
    """Where Whisper runs and why: {"device": "cuda"|"cpu", "name", "reason"}. Shown in Settings → AI."""
    if _device:
        return dict(_device)
    import torch

    if torch.cuda.is_available():
        _use_torch_cuda_libs(torch)
        info = {"device": "cuda", "name": torch.cuda.get_device_name(0), "reason": ""}
    elif sys.platform == "darwin":
        info = {"device": "cpu", "name": "", "reason": "apple"}  # CTranslate2 has no Metal backend
    elif not torch.version.cuda:
        info = {"device": "cpu", "name": "", "reason": "torch_cpu"}  # a torch build without CUDA
    else:
        info = {"device": "cpu", "name": "", "reason": "no_gpu"}  # CUDA build, but no NVIDIA GPU / driver
    _device.update(info)
    return dict(info)


def _model(size: str):
    if size not in _models:
        info = device()
        from faster_whisper import WhisperModel

        if info["device"] == "cuda":
            try:
                logger.info("Loading Faster-Whisper %s on cuda (float16), %s", size, info["name"])
                _models[size] = WhisperModel(size, device="cuda", compute_type="float16")
                return _models[size]
            except Exception as e:  # missing cuBLAS/cuDNN, out of memory: still transcribe, on the CPU
                logger.warning("CUDA unavailable for Whisper (%s), falling back to CPU", e)
                _device.update({"device": "cpu", "name": "", "reason": f"cuda_failed: {str(e)[:200]}"})
        logger.info("Loading Faster-Whisper %s on cpu (int8)", size)
        _models[size] = WhisperModel(size, device="cpu", compute_type="int8", cpu_threads=4)
    return _models[size]


def transcribe(
    audio_path: str,
    duration: float,
    model_size: str,
    language: str = "auto",
    vocabulary: str = "",
    check_cancelled: Callable[[], None] = lambda: None,
    on_progress: Callable[[float], None] | None = None,
) -> list[dict]:
    kwargs: dict[str, Any] = {"beam_size": 5, "vad_filter": False}  # Silero already removed silence
    if language and language != "auto":
        kwargs["language"] = language
    if vocabulary.strip():
        kwargs["initial_prompt"] = vocabulary.strip()

    segments, _info = _model(model_size).transcribe(audio_path, **kwargs)
    out: list[dict] = []
    for seg in segments:
        check_cancelled()
        out.append({"clean_start": seg.start, "clean_end": seg.end, "text": seg.text})
        if on_progress and duration > 0:
            on_progress(min(1.0, seg.end / duration))
    return out
