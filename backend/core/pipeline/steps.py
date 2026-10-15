"""
Pipeline steps. Each step owns one responsibility and declares when it runs (enabled)
and how heavy it is (weight) so the runner can map step-local progress to a global bar.
"""

import logging
from abc import ABC, abstractmethod
from collections.abc import Callable
from pathlib import Path

from backend.core.ai import AI
from backend.core.media import AudioProcessor, VideoProcessor, check_input, extract_wav, probe_video
from backend.core.timeline import TimeMap, frame_snap
from backend.core.transcription import compact_transcript, segments_from_clean, write_transcripts
from backend.core.vad import detect_speech
from backend.models.job import JobOptions, JobStats, Stage
from backend.models.lesson import SCHEMA_VERSION, Lesson
from backend.models.transcript import Segment
from backend.services.jobs import JobCancelled
from backend.services.storage import Artifacts, Library
from backend.settings import SettingsService, paths
from backend.utils.fs import remove_file, write_json, write_text

logger = logging.getLogger(__name__)

ProgressFn = Callable[[float, str], None]


class JobContext:
    """State shared by the steps of one job."""

    def __init__(
        self,
        job_id: str,
        options: JobOptions,
        media_path: str | None = None,
        is_uploaded: bool = False,
        lesson: Lesson | None = None,
        cancel_check: Callable[[], bool] = lambda: False,
    ):
        self.job_id = job_id
        self.options = options
        self.media_path = media_path
        self.is_uploaded = is_uploaded
        self.lesson = lesson
        self._cancel_check = cancel_check

        data = paths().ensure()
        self.lesson_dir: Path = data.lesson_dir(lesson.job_id if lesson else job_id)
        self.lesson_dir.mkdir(parents=True, exist_ok=True)
        self.raw_wav: Path = data.temp / f"{job_id}_raw.wav"
        self.work_dir: Path = data.temp / f"{job_id}_work"

        self.fps: float | None = None
        self.orig_duration = 0.0
        self.clean_duration = lesson.clean_duration_sec if lesson else 0.0
        self.spans: list[tuple[float, float]] = []
        self.time_map: TimeMap | None = None
        self.segments: list[Segment] = []
        self.stats = JobStats()
        self.warning: str | None = None

    @property
    def has_video_source(self) -> bool:
        return self.fps is not None

    def check_cancelled(self) -> None:
        if self._cancel_check():
            raise JobCancelled()

    def cleanup(self) -> None:
        remove_file(self.raw_wav)
        if self.work_dir.exists():
            import shutil
            shutil.rmtree(self.work_dir, ignore_errors=True)
        if self.is_uploaded:
            remove_file(self.media_path)


class PipelineStep(ABC):
    stage: Stage
    weight: float = 1.0

    def enabled(self, ctx: JobContext) -> bool:
        return True

    @abstractmethod
    def execute(self, ctx: JobContext, progress: ProgressFn) -> None:
        """Run the step; call progress(fraction 0..1, message)."""


class ExtractAudioStep(PipelineStep):
    stage = "extract"
    weight = 1

    def execute(self, ctx, progress):
        progress(0, "Извлечение аудио")
        check_input(ctx.media_path)  # also guards paths that skip the API check (MCP, tests)
        ctx.fps = probe_video(ctx.media_path) if ctx.options.clean_video else None
        ctx.orig_duration = extract_wav(ctx.media_path, ctx.raw_wav, ctx.options.enhance_audio)
        ctx.stats.orig_duration_sec = round(ctx.orig_duration, 3)
        ctx.stats.fps = round(ctx.fps or 0.0, 3)


class DetectSpeechStep(PipelineStep):
    stage = "vad"
    weight = 2

    def execute(self, ctx, progress):
        progress(0, "Поиск речи (Silero VAD)")
        o = ctx.options
        spans = detect_speech(str(ctx.raw_wav), o.vad_threshold, o.min_silence_ms, o.speech_pad_ms)
        # Same frame-aligned spans drive audio and video, so both clean timelines match exactly.
        ctx.spans = frame_snap(spans, ctx.fps, ctx.orig_duration)


class BuildCleanAudioStep(PipelineStep):
    stage = "audio"
    weight = 1

    def execute(self, ctx, progress):
        progress(0, "Сборка чистого аудио")
        res = AudioProcessor().process(ctx.raw_wav, ctx.lesson_dir / Artifacts.AUDIO, ctx.spans)
        write_json(ctx.lesson_dir / Artifacts.TIME_MAP, res["time_map"])
        ctx.time_map = TimeMap(res["time_map"])
        ctx.clean_duration = res["clean_duration_sec"]
        ctx.stats.clean_duration_sec = ctx.clean_duration
        ctx.stats.speech_segments_count = len(res["time_map"])
        ctx.stats.saved_percent = round((ctx.orig_duration - ctx.clean_duration) / ctx.orig_duration * 100, 1) if ctx.orig_duration else 0.0


class BuildCleanVideoStep(PipelineStep):
    stage = "video"
    weight = 6

    def enabled(self, ctx):
        return ctx.options.clean_video and ctx.has_video_source

    def execute(self, ctx, progress):
        progress(0, f"Монтаж видео (CRF {ctx.options.video_crf}, {ctx.options.video_resolution})")
        try:
            res = VideoProcessor(ctx.options.video_crf, ctx.options.video_resolution).process(
                ctx.media_path, ctx.lesson_dir / Artifacts.VIDEO, ctx.spans
            )
        except Exception as e:
            ctx.warning = f"Видео не собрано, аудио сохранено: {e}"
            logger.warning(ctx.warning, exc_info=True)
            return
        ctx.stats.has_video = True
        ctx.stats.orig_video_size_mb = res["orig_size_mb"]
        ctx.stats.clean_video_size_mb = res["clean_size_mb"]
        ctx.stats.video_saved_percent = res["saved_percent"]
        ctx.stats.av_drift_sec = round(res["duration_sec"] - ctx.clean_duration, 3)
        if abs(ctx.stats.av_drift_sec) > 0.5:
            ctx.warning = f"Расхождение длительности видео и аудио: {ctx.stats.av_drift_sec:+.2f} с"


class TranscribeStep(PipelineStep):
    stage = "transcribe"
    weight = 5

    def enabled(self, ctx):
        return ctx.options.mode != "audio_only"

    def execute(self, ctx, progress):
        o, ai = ctx.options, SettingsService.get().ai
        audio = str(ctx.lesson_dir / Artifacts.AUDIO)
        def on_progress(f):
            return progress(f, f"Транскрибация {int(f * 100)}%")

        if o.mode == "gemini":
            from backend.core.transcription import gemini

            key = SettingsService.api_key("gemini")
            if not key:
                raise ValueError("Нет API-ключа Gemini. Настройки → ИИ")
            progress(0, f"Транскрибация (Gemini {ai.gemini_model})")
            raw = gemini.transcribe(
                audio, ctx.clean_duration, key, ai.gemini_model, ctx.work_dir, o.language, o.custom_vocabulary, ctx.check_cancelled, on_progress,
            )
        else:
            from backend.core.transcription import whisper

            progress(0, f"Транскрибация (Whisper {ai.whisper_model})")
            raw = whisper.transcribe(
                audio, ctx.clean_duration, ai.whisper_model, o.language, o.custom_vocabulary, ctx.check_cancelled, on_progress,
            )

        ctx.segments = segments_from_clean(raw, ctx.time_map or TimeMap([]))
        write_transcripts(ctx.lesson_dir, ctx.segments)


def audit_provider(mode: str) -> str:
    """Engine mode decides the audit model; plain Whisper falls back to the preferred provider from settings."""
    return {"deepseek": "deepseek", "gemini": "gemini"}.get(mode, SettingsService.get().ai.assistant_provider)


class GenerateAuditStep(PipelineStep):
    """strict=False (inside processing): an AI failure becomes a warning, the lesson is still saved."""

    stage = "audit"
    weight = 3

    def __init__(self, strict: bool = False):
        self.strict = strict

    def enabled(self, ctx):
        return ctx.options.generate_audit and ctx.options.mode != "audio_only"

    def execute(self, ctx, progress):
        if not ctx.segments:
            ctx.warning = "Стенограмма пуста — аудит не создан"
            return
        provider_name = audit_provider(ctx.options.mode)
        if not SettingsService.api_key(provider_name):
            if self.strict:
                raise ValueError(f"Нет API-ключа {provider_name}. Настройки → ИИ")
            ctx.warning = f"Нет ключа {provider_name} — аудит не создан. Настройки → ИИ"
            return
        timed = ctx.options.audit_mode == "srt_timecodes"
        try:
            provider = AI.get(provider_name)
            progress(0, f"Аудит ({provider_name} {provider.model})")
            md = provider.generate_audit(compact_transcript(ctx.segments), ctx.clean_duration, timed, progress)
        except Exception as e:
            if self.strict:
                raise
            ctx.warning = f"Аудит не создан: {e}"
            logger.warning(ctx.warning, exc_info=True)
            return
        write_text(ctx.lesson_dir / Artifacts.AUDIT, md)


class SaveLessonStep(PipelineStep):
    stage = "save"
    weight = 0.5

    def execute(self, ctx, progress):
        progress(0, "Сохранение урока")
        o = ctx.options
        base = ctx.lesson or Lesson(
            id=f"less_{ctx.job_id}",
            job_id=ctx.job_id,
            project_id=o.project_id,
            title=o.lesson_title.strip() or f"Урок {ctx.job_id}",
            notes=o.notes,
            status="in_progress" if ctx.segments else "to_review",
        )
        if not ctx.lesson:
            base = base.model_copy(update={
                "orig_duration_sec": ctx.stats.orig_duration_sec,
                "clean_duration_sec": ctx.stats.clean_duration_sec,
                "saved_percent": ctx.stats.saved_percent,
                "schema_version": SCHEMA_VERSION,
            })
        ctx.lesson = Library.save_lesson(base)

        if o.export_after and SettingsService.get().export_dir:
            from backend.services.export import export_lesson

            try:
                export_lesson(ctx.lesson.id, raw_wav=ctx.raw_wav)
            except Exception as e:
                ctx.warning = f"Экспорт не выполнен: {e}"


PROCESS_STEPS: list[PipelineStep] = [
    ExtractAudioStep(),
    DetectSpeechStep(),
    BuildCleanAudioStep(),
    BuildCleanVideoStep(),
    TranscribeStep(),
    GenerateAuditStep(),
    SaveLessonStep(),
]

AUDIT_STEPS: list[PipelineStep] = [GenerateAuditStep(strict=True), SaveLessonStep()]
