"""
Local speech-recognition engines behind one interface. Each returns phrases on the clean timeline:
[{"clean_start", "clean_end", "text"}]. Which one runs is decided by core/compute.plan(), not here.

  FasterWhisperEngine — CTranslate2: NVIDIA GPU (CUDA, float16) or the CPU (int8, N threads)
  MlxWhisperEngine    — MLX: the Apple Silicon GPU (Metal)

A new engine = a subclass with `backend` and `transcribe`, registered in ENGINES.
"""

import logging
import os
import sys
from abc import ABC, abstractmethod
from collections.abc import Callable
from typing import Any, ClassVar

from backend.core.compute import Backend

logger = logging.getLogger(__name__)

Progress = Callable[[float], None]
Cancel = Callable[[], None]

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


class WhisperEngine(ABC):
    backends: ClassVar[tuple[Backend, ...]]  # compute backends this engine runs on

    def __init__(self, backend: Backend, threads: int):
        self.backend, self.threads = backend, threads

    @abstractmethod
    def transcribe(
        self, audio: str, duration: float, size: str, language: str, vocabulary: str, check_cancelled: Cancel, on_progress: Progress | None
    ) -> list[dict]:
        """Phrases of the whole file; report progress 0..1 and call check_cancelled between pieces."""


# ---------------------------------------------------------------- Faster-Whisper (CUDA / CPU)

_dll_dirs: list[Any] = []  # handles of os.add_dll_directory(): dropping one removes the directory from the search path


def _use_torch_cuda_libs() -> None:
    """Windows: CTranslate2 loads cuBLAS/cuDNN from the DLL search path, while the CUDA build of torch ships them in
    torch/lib. Point one at the other before faster_whisper imports ctranslate2: no separate NVIDIA install needed."""
    if sys.platform != "win32" or _dll_dirs:
        return
    import torch

    lib = os.path.join(os.path.dirname(torch.__file__), "lib")
    if os.path.isdir(lib):
        _dll_dirs.append(os.add_dll_directory(lib))


class FasterWhisperEngine(WhisperEngine):
    backends = ("cuda", "cpu")
    _models: ClassVar[dict[tuple, Any]] = {}

    def _model(self, size: str):
        key = (size, self.backend, self.threads)
        if key not in self._models:
            if self.backend == "cuda":
                _use_torch_cuda_libs()
            from faster_whisper import WhisperModel

            if self.backend == "cuda":
                logger.info("Loading Faster-Whisper %s on cuda (float16)", size)
                self._models[key] = WhisperModel(size, device="cuda", compute_type="float16")
            else:
                logger.info("Loading Faster-Whisper %s on cpu (int8, %d threads)", size, self.threads)
                self._models[key] = WhisperModel(size, device="cpu", compute_type="int8", cpu_threads=self.threads)
        return self._models[key]

    def transcribe(self, audio, duration, size, language, vocabulary, check_cancelled, on_progress):
        kwargs: dict[str, Any] = {"beam_size": 5, "vad_filter": False}  # Silero already removed silence
        if language and language != "auto":
            kwargs["language"] = language
        if vocabulary.strip():
            kwargs["initial_prompt"] = vocabulary.strip()
        segments, _info = self._model(size).transcribe(audio, **kwargs)
        out: list[dict] = []
        for seg in segments:
            check_cancelled()
            out.append({"clean_start": seg.start, "clean_end": seg.end, "text": seg.text})
            if on_progress and duration > 0:
                on_progress(min(1.0, seg.end / duration))
        return out


# ---------------------------------------------------------------- MLX (Apple GPU)

MLX_MODELS = {
    "large-v3-turbo": "mlx-community/whisper-large-v3-turbo",
    "large-v3": "mlx-community/whisper-large-v3-mlx",
    "medium": "mlx-community/whisper-medium-mlx",
    "small": "mlx-community/whisper-small-mlx",
}
MLX_WINDOW_SEC = 300  # pieces of the clean audio: progress and cancel between them


class MlxWhisperEngine(WhisperEngine):
    backends = ("apple",)

    def transcribe(self, audio, duration, size, language, vocabulary, check_cancelled, on_progress):
        import mlx_whisper

        repo = MLX_MODELS.get(size, MLX_MODELS["large-v3-turbo"])
        options: dict[str, Any] = {}
        if language and language != "auto":
            options["language"] = language
        out: list[dict] = []
        start = 0.0
        total = max(duration, 1.0)
        logger.info("Transcribing with MLX Whisper %s on the Apple GPU", repo)
        while True:
            check_cancelled()
            end = min(start + MLX_WINDOW_SEC, total)
            result = mlx_whisper.transcribe(
                audio,
                path_or_hf_repo=repo,
                verbose=None,
                initial_prompt=vocabulary.strip() or None,
                condition_on_previous_text=False,  # no runaway repetition across windows
                clip_timestamps=[start, end],
                **options,
            )
            for seg in result.get("segments", []):
                out.append({"clean_start": float(seg["start"]), "clean_end": float(seg["end"]), "text": seg["text"]})
            if on_progress:
                on_progress(min(1.0, end / total))
            if end >= total:
                return out
            start = end


ENGINES: tuple[type[WhisperEngine], ...] = (FasterWhisperEngine, MlxWhisperEngine)


def engine_for(backend: Backend, threads: int) -> WhisperEngine:
    cls = next(e for e in ENGINES if backend in e.backends)
    return cls(backend, threads)
