"""
Pipeline runner: executes steps for one job, maps step progress to a global percentage,
publishes state to JobRegistry. Jobs run one at a time on a single worker thread
(Whisper and FFmpeg saturate the machine anyway), so extra jobs simply queue. Within a job, neighbouring steps that
share a `together` key (the video encode and the transcription) run at once when each says it pays off here.
"""

import contextvars
import logging
import threading
from concurrent.futures import ThreadPoolExecutor

from backend.core.media.base import low_priority
from backend.core.pipeline.steps import AUDIT_STEPS, PROCESS_STEPS, TRANSCRIBE_STEPS, JobContext, PipelineStep
from backend.core.timeline import TimeMap
from backend.core.transcription import load_segments
from backend.i18n import tr
from backend.models.job import Job, JobOptions, Stage
from backend.models.lesson import Lesson
from backend.services.jobs import JobCancelled, JobRegistry
from backend.services.storage import Artifacts
from backend.settings.service import SettingsService
from backend.utils.fs import read_json

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="pipeline")


def _planned(steps: list[PipelineStep], options: JobOptions) -> list[PipelineStep]:
    """Steps expected to run for these options (a video step for a file without video is skipped at run time)."""
    skip = {
        "vad": not options.cut_silence,
        "video": options.video == "none",
        "transcribe": options.transcriber == "none",
        "audit": options.audit == "none",
    }
    return [s for s in steps if not skip.get(s.stage, False)]


class LecturePipeline:
    def __init__(self, steps: list[PipelineStep]):
        self.steps = steps

    def run(self, job: Job, ctx: JobContext) -> None:
        planned = _planned(self.steps, ctx.options)
        self.job, self.ctx, self.total = job, ctx, sum(s.weight for s in planned) or 1.0
        done = 0.0
        for group in _groups(planned):
            ctx.check_cancelled()
            active = [s for s in group if s.enabled(ctx)]
            if len(active) > 1 and all(s.may_overlap(ctx) for s in active):
                self._together(active, done)
            else:
                start = done
                for step in active:
                    self._one(step, start + sum(s.weight for s in group[: group.index(step)]))
            done += sum(s.weight for s in group)

    def _publish(self, stage: Stage, start: float, weighted: float, message: str) -> None:
        pct = int((start + weighted) / self.total * 100)
        JobRegistry.update(self.job.id, status="processing", stage=stage, progress=min(pct, 99), message=message)

    def _one(self, step: PipelineStep, start: float) -> None:
        def progress(fraction: float, message: str) -> None:
            self.ctx.check_cancelled()
            self._publish(step.stage, start, step.weight * max(0.0, min(1.0, fraction)), message)

        progress(0, step.stage)
        logger.info("[%s] step %s", self.job.id, step.stage)
        step.execute(self.ctx, progress)

    def _together(self, steps: list[PipelineStep], start: float) -> None:
        """Steps at once, one thread each. The job shows the first unfinished one as its stage and every running
        step's line in its message; the percentage adds them up. The first error (a cancel first) is raised after all
        of them stopped: a cancel reaches each through its own progress calls."""
        state = {s.stage: (0.0, "") for s in steps}
        lock = threading.Lock()

        def publish() -> None:
            running = [s for s in steps if state[s.stage][0] < 1]
            message = " · ".join(state[s.stage][1] for s in running if state[s.stage][1])
            self._publish((running or steps)[0].stage, start, sum(s.weight * state[s.stage][0] for s in steps), message)

        def run(step: PipelineStep) -> None:
            def progress(fraction: float, message: str) -> None:
                self.ctx.check_cancelled()
                with lock:
                    state[step.stage] = (max(0.0, min(0.999, fraction)), message)
                    publish()

            progress(0, step.stage)
            step.execute(self.ctx, progress)
            with lock:
                state[step.stage] = (1.0, "")
                publish()

        logger.info("[%s] steps at once: %s", self.job.id, ", ".join(s.stage for s in steps))
        with ThreadPoolExecutor(len(steps), thread_name_prefix="pipeline-part") as pool:
            futures = [pool.submit(contextvars.copy_context().run, run, s) for s in steps]
        errors = [e for f in futures if (e := f.exception())]
        if errors:
            raise next((e for e in errors if isinstance(e, JobCancelled)), errors[0])


def _groups(steps: list[PipelineStep]) -> list[list[PipelineStep]]:
    """Planned steps in order, neighbours with the same `together` key in one group."""
    groups: list[list[PipelineStep]] = []
    for step in steps:
        if groups and step.together and groups[-1][-1].together == step.together:
            groups[-1].append(step)
        else:
            groups.append([step])
    return groups


def _execute(job: Job, steps: list[PipelineStep], ctx: JobContext) -> None:
    quiet = low_priority.set(SettingsService.get().compute.quiet)  # FFmpeg of this job, also in the parallel parts
    try:
        LecturePipeline(steps).run(job, ctx)
        JobRegistry.update(
            job.id, status="completed", stage="done", progress=100, message=tr("job.done"),
            stats=ctx.stats, warning=ctx.warning, lesson_id=ctx.lesson.id if ctx.lesson else None,
        )
    except JobCancelled:
        JobRegistry.update(job.id, status="cancelled", message=tr("job.cancelled"))
    except Exception as e:
        logger.error("[%s] failed: %s", job.id, e, exc_info=True)
        JobRegistry.update(job.id, status="error", error=str(e), message=tr("job.failed"))
    finally:
        low_priority.reset(quiet)
        ctx.cleanup()


def _stages(steps: list[PipelineStep], options: JobOptions) -> list[Stage]:
    return [s.stage for s in _planned(steps, options)]


def start_processing(options: JobOptions, media_path: str, is_uploaded: bool) -> Job:
    title = options.lesson_title.strip() or tr("job.new_lesson")
    job = JobRegistry.create("process", title, _stages(PROCESS_STEPS, options))
    ctx = JobContext(job.id, options, media_path, is_uploaded, cancel_check=lambda: JobRegistry.is_cancel_requested(job.id))
    _executor.submit(_execute, job, PROCESS_STEPS, ctx)
    return job


def start_transcription(lesson: Lesson, options: JobOptions) -> Job:
    """Recognize speech of an existing lesson from its clean audio (media is not redone), then the audit if enabled."""
    job = JobRegistry.create("process", tr("job.transcribe_title", title=lesson.title), _stages(TRANSCRIBE_STEPS, options))
    ctx = JobContext(job.id, options, lesson=lesson, cancel_check=lambda: JobRegistry.is_cancel_requested(job.id))
    ctx.time_map = TimeMap(read_json(ctx.lesson_dir / Artifacts.TIME_MAP, default=[]) or [])
    _executor.submit(_execute, job, TRANSCRIBE_STEPS, ctx)
    return job


def start_audit(lesson: Lesson, provider: str, audit_mode: str, source: str = "transcript", output_language: str = "interface") -> Job:
    options = JobOptions(audit=provider, audit_mode=audit_mode, audit_source=source, video="clean", output_language=output_language)
    job = JobRegistry.create("audit", tr("job.audit_title", title=lesson.title), _stages(AUDIT_STEPS, options))
    ctx = JobContext(job.id, options, lesson=lesson, cancel_check=lambda: JobRegistry.is_cancel_requested(job.id))
    ctx.segments = load_segments(ctx.lesson_dir)
    _executor.submit(_execute, job, AUDIT_STEPS, ctx)
    return job
