"""
Local speech recognition (Whisper) on the device of a compute plan (core/compute): NVIDIA GPU, Apple GPU or the CPU.
A GPU that fails at runtime hands the job to the CPU (and later plans go straight there), so a job never fails
because of the graphics card. The caller (the pipeline) makes the plan from the settings.
"""

import logging
from collections.abc import Callable

from backend.core import compute
from backend.core.transcription.engines import engine_for

logger = logging.getLogger(__name__)


def transcribe(
    audio_path: str,
    duration: float,
    model_size: str,
    language: str = "auto",
    vocabulary: str = "",
    check_cancelled: Callable[[], None] = lambda: None,
    on_progress: Callable[[float], None] | None = None,
    plan: compute.Plan | None = None,
) -> list[dict]:
    plan = plan or compute.plan()
    args = (audio_path, duration, model_size, language, vocabulary, check_cancelled, on_progress)
    try:
        return engine_for(plan.backend, plan.threads, plan.quiet).transcribe(*args)
    except Exception as e:
        if plan.backend == "cpu":
            raise
        check_cancelled()  # a cancelled job stops here (raises), it does not retry on the CPU
        compute.mark_failed(plan.backend, str(e))
        return engine_for("cpu", plan.threads, plan.quiet).transcribe(*args)
