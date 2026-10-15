"""
Pipeline runner: executes steps for one job, maps step progress to a global percentage,
publishes state to JobRegistry. Jobs run one at a time on a single worker thread
(Whisper and FFmpeg saturate the machine anyway), so extra jobs simply queue.
"""

import logging
from concurrent.futures import ThreadPoolExecutor

from backend.core.pipeline.steps import AUDIT_STEPS, PROCESS_STEPS, JobContext, PipelineStep
from backend.core.transcription import load_segments
from backend.models.job import Job, JobOptions, Stage
from backend.models.lesson import Lesson
from backend.services.jobs import JobCancelled, JobRegistry

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="pipeline")


def _planned(steps: list[PipelineStep], options: JobOptions) -> list[PipelineStep]:
    """Steps expected to run (video is assumed present until probed)."""
    out = []
    for s in steps:
        if s.stage == "video":
            if options.clean_video:
                out.append(s)
        elif s.stage in ("transcribe", "audit") and options.mode == "audio_only":
            continue
        elif s.stage == "audit" and not options.generate_audit:
            continue
        else:
            out.append(s)
    return out


class LecturePipeline:
    def __init__(self, steps: list[PipelineStep]):
        self.steps = steps

    def run(self, job: Job, ctx: JobContext) -> None:
        planned = _planned(self.steps, ctx.options)
        total = sum(s.weight for s in planned) or 1.0
        done = 0.0

        for step in planned:
            ctx.check_cancelled()
            if not step.enabled(ctx):
                done += step.weight
                continue
            start = done

            def progress(fraction: float, message: str, _start=start, _w=step.weight, _stage=step.stage):
                ctx.check_cancelled()
                pct = int((_start + _w * max(0.0, min(1.0, fraction))) / total * 100)
                JobRegistry.update(job.id, status="processing", stage=_stage, progress=min(pct, 99), message=message)

            progress(0, step.stage)
            logger.info("[%s] step %s", job.id, step.stage)
            step.execute(ctx, progress)
            done += step.weight


def _execute(job: Job, steps: list[PipelineStep], ctx: JobContext) -> None:
    try:
        LecturePipeline(steps).run(job, ctx)
        JobRegistry.update(
            job.id, status="completed", stage="done", progress=100, message="Готово",
            stats=ctx.stats, warning=ctx.warning, lesson_id=ctx.lesson.id if ctx.lesson else None,
        )
    except JobCancelled:
        JobRegistry.update(job.id, status="cancelled", message="Отменено")
    except Exception as e:
        logger.error("[%s] failed: %s", job.id, e, exc_info=True)
        JobRegistry.update(job.id, status="error", error=str(e), message="Ошибка")
    finally:
        ctx.cleanup()


def _stages(steps: list[PipelineStep], options: JobOptions) -> list[Stage]:
    return [s.stage for s in _planned(steps, options)]


def start_processing(options: JobOptions, media_path: str, is_uploaded: bool) -> Job:
    title = options.lesson_title.strip() or "Новый урок"
    job = JobRegistry.create("process", title, _stages(PROCESS_STEPS, options))
    ctx = JobContext(job.id, options, media_path, is_uploaded, cancel_check=lambda: JobRegistry.is_cancel_requested(job.id))
    _executor.submit(_execute, job, PROCESS_STEPS, ctx)
    return job


def start_audit(lesson: Lesson, provider: str, audit_mode: str) -> Job:
    options = JobOptions(mode=provider, audit_mode=audit_mode, generate_audit=True, clean_video=False)
    job = JobRegistry.create("audit", f"Аудит: {lesson.title}", _stages(AUDIT_STEPS, options))
    ctx = JobContext(job.id, options, lesson=lesson, cancel_check=lambda: JobRegistry.is_cancel_requested(job.id))
    ctx.segments = load_segments(ctx.lesson_dir)
    _executor.submit(_execute, job, AUDIT_STEPS, ctx)
    return job
