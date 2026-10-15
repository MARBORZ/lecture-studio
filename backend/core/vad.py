"""
Silero VAD speech detection. Returns speech spans in seconds.
"""

import logging
from typing import List, Tuple

import numpy as np
import soundfile as sf
import torch

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16000
_model = None


def _get_model():
    global _model
    if _model is None:
        from silero_vad import load_silero_vad

        try:
            _model = load_silero_vad(onnx=True)
        except Exception as e:  # onnxruntime missing or broken
            logger.warning("Silero ONNX unavailable (%s), using PyTorch", e)
            _model = load_silero_vad(onnx=False)
    return _model


def detect_speech(
    wav_path: str,
    threshold: float = 0.5,
    min_silence_ms: int = 800,
    speech_pad_ms: int = 250,
) -> List[Tuple[float, float]]:
    """16 kHz mono WAV -> [(start_sec, end_sec)] of speech."""
    from silero_vad import get_speech_timestamps

    data, sr = sf.read(str(wav_path), dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    if sr != SAMPLE_RATE:
        raise ValueError(f"VAD ожидает {SAMPLE_RATE} Гц, получено {sr}")

    stamps = get_speech_timestamps(
        torch.from_numpy(np.ascontiguousarray(data)),
        _get_model(),
        sampling_rate=SAMPLE_RATE,
        threshold=threshold,
        min_silence_duration_ms=min_silence_ms,
        speech_pad_ms=speech_pad_ms,
        return_seconds=False,
    )
    return [(s["start"] / SAMPLE_RATE, s["end"] / SAMPLE_RATE) for s in stamps]
