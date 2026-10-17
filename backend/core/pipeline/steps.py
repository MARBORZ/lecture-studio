"""
Pipeline steps. Each step owns one responsibility and declares when it runs (enabled)
and how heavy it is (weight) so the runner can map step-local progress to a global bar.
"""

import logging
import shutil
from abc import ABC, abstractmethod
from collections.abc import Callable
from pathlib import Path

from backend.core import language
from backend.core.ai import AI
from backend.core.media import (
    AudioProcessor,
    VideoProcessor,
    browser_playback_problem,
    check_input,
    encode_mp3,
    extract_wav,
    make_analysis_proxy,
    probe_video,
)
from backend.core.timeline import TimeMap, frame_snap
from backend.core.transcription import compact_transcript, segments_from_clean, write_transcripts
from backend.core.vad import detect_speech
from backend.i18n import tr
from backend.models.job import JobOptions, JobStats, Stage
from backend.models.lesson import SCHEMA_VERSION, Lesson
from backend.models.transcript import Segment
from backend.services.jobs import JobCancelled
from backend.services.storage import Artifacts, LessonFiles, Lessons
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
        self.work_dir.mkdir(parents=True, exist_ok=True)

        self.fps: float | None = None
        self.orig_duration = 0.0
        self.clean_duration = lesson.clean_duration_sec if lesson else 0.0
        self.spans: list[tuple[float, float]] = []
        self.time_map: TimeMap | None = None
        self.segments: list[Segment] = []
        self.stats = JobStats()
        self.warnings: list[str] = []
        self.speech_language = lesson.speech_language if lesson else ""
        self.audit_language = lesson.audit_language if lesson else ""
        self.original_file = lesson.original_file if lesson else ""
        self.original_kind = lesson.original_kind if lesson else ""

    def warn(self, message: str) -> None:
        """Steps add warnings; the job shows all of them (one step must not hide another's)."""
        logger.warning("[%s] %s", self.job_id, message)
        self.warnings.append(message)

    @property
    def warning(self) -> str | None:
        return "\n".join(self.warnings) or None

    def speech_audio(self) -> str:
        """Audio for recognition: the lesson's clean MP3, the job's WAV, or (Eco, re-recognition) a WAV extracted from
        the original recording."""
        own = self.lesson_dir / Artifacts.AUDIO
        if own.is_file():
            return str(own)
        if not self.raw_wav.is_file():
            source = LessonFiles.media(self.lesson, "audio") if self.lesson else None
            if not source:
                raise FileNotFoundError(tr("step.no_speech_audio"))
            extract_wav(source, self.raw_wav)
        return str(self.raw_wav)

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
    # Neighbouring steps with the same key need nothing from each other: the runner may run them at once
    together: str = ""

    def enabled(self, ctx: JobContext) -> bool:
        return True

    def may_overlap(self, ctx: JobContext) -> bool:
        """Whether running next to its `together` neighbours pays off here (not when they would fight for the CPU)."""
        return not SettingsService.get().compute.quiet

    @abstractmethod
    def execute(self, ctx: JobContext, progress: ProgressFn) -> None:
        """Run the step; call progress(fraction 0..1, message)."""


class ExtractAudioStep(PipelineStep):
    stage = "extract"
    weight = 1

    def execute(self, ctx, progress):
        progress(0, tr("step.extract"))
        check_input(ctx.media_path)  # also guards paths that skip the API check (MCP, tests)
        ctx.fps = probe_video(ctx.media_path) if ctx.options.video != "none" else None
        ctx.orig_duration = extract_wav(ctx.media_path, ctx.raw_wav, ctx.options.enhance_audio)
        ctx.stats.orig_duration_sec = round(ctx.orig_duration, 3)
        ctx.stats.fps = round(ctx.fps or 0.0, 3)


class DetectSpeechStep(PipelineStep):
    """Only with cut_silence; without it the whole recording is one span (the clean timeline = the original one)."""

    stage = "vad"
    weight = 2

    def enabled(self, ctx):
        return ctx.options.cut_silence

    def execute(self, ctx, progress):
        progress(0, tr("step.vad"))
        o = ctx.options
        spans = detect_speech(str(ctx.raw_wav), o.vad_threshold, o.min_silence_ms, o.speech_pad_ms)
        # Same frame-aligned spans drive audio and video, so both clean timelines match exactly.
        ctx.spans = frame_snap(spans, ctx.fps, ctx.orig_duration)


class BuildCleanAudioStep(PipelineStep):
    stage = "audio"
    weight = 1

    def execute(self, ctx, progress):
        if not ctx.spans:
            ctx.spans = [(0.0, ctx.orig_duration)]  # nothing cut
        if ctx.options.keeps_audio_file:
            progress(0, tr("step.clean_audio" if ctx.options.cut_silence else "step.compress_audio"))
            res = AudioProcessor().process(ctx.raw_wav, ctx.lesson_dir / Artifacts.AUDIO, ctx.spans)
            time_map, clean = res["time_map"], res["clean_duration_sec"]
        else:  # the original recording plays as is: no audio copy, the timeline is the file's own
            time_map = [{"segment_index": 0, "orig_start": 0.0, "orig_end": ctx.orig_duration, "clean_start": 0.0, "clean_end": ctx.orig_duration}]
            clean = ctx.orig_duration
        write_json(ctx.lesson_dir / Artifacts.TIME_MAP, time_map)
        ctx.time_map = TimeMap(time_map)
        ctx.clean_duration = clean
        ctx.stats.clean_duration_sec = ctx.clean_duration
        ctx.stats.speech_segments_count = len(time_map)
        ctx.stats.saved_percent = round((ctx.orig_duration - ctx.clean_duration) / ctx.orig_duration * 100, 1) if ctx.orig_duration else 0.0


class BuildVideoStep(PipelineStep):
    """video: clean (jump-cut) | compressed (whole, re-encoded) | original (the file itself, nothing encoded) | none."""

    stage = "video"
    weight = 6
    together = "media"  # needs the spans only; transcription needs the clean audio: both are ready by now

    def enabled(self, ctx):
        v = ctx.options.video
        return v == "original" or (v in ("clean", "compressed") and ctx.has_video_source)

    def execute(self, ctx, progress):
        if ctx.options.video == "original":
            self._keep_original(ctx, progress)
        else:
            self._encode(ctx, progress)

    def _keep_original(self, ctx, progress):
        progress(0, tr("step.keep_original"))
        source = Path(ctx.media_path)
        if ctx.is_uploaded:  # an upload is already a copy: move it into the lesson (same disk, no second copy)
            name = f"original{source.suffix.lower()}"
            shutil.move(str(source), ctx.lesson_dir / name)
            ctx.is_uploaded = False
            ctx.original_file = name
        else:  # Eco: the file stays where it is
            ctx.original_file = str(source.resolve())
        ctx.original_kind = "video" if ctx.has_video_source else "audio"
        ctx.stats.has_video = ctx.has_video_source
        problem = browser_playback_problem(LessonFiles.original_of(ctx.lesson_dir, ctx.original_file))
        if problem:
            ctx.warn(tr("step.original_unplayable", problem=problem))

    def _encode(self, ctx, progress):
        from backend.core import compute
        from backend.core.media.video import pick_encoder

        c = SettingsService.get().compute
        plan = compute.plan(c.device, c.cpu_threads, c.quiet)
        encoder = pick_encoder(plan.backend)
        label = tr("step.encoder_gpu" if encoder == "nvenc" else "step.encoder_cpu")
        what = tr("step.video_edit" if ctx.options.video == "clean" else "step.video_compress")
        progress(0, tr("step.video_progress", what=what, encoder=label, crf=ctx.options.video_crf, resolution=ctx.options.video_resolution))
        spans = ctx.spans if ctx.options.cut_silence else []  # [] = the whole video, nothing cut
        try:
            res = VideoProcessor(ctx.options.video_crf, ctx.options.video_resolution, encoder=encoder, threads=plan.threads if plan.quiet else 0).process(
                ctx.media_path, ctx.lesson_dir / Artifacts.VIDEO, spans
            )
        except Exception as e:
            ctx.warn(tr("step.video_failed", error=e))
            return
        ctx.stats.has_video = True
        ctx.stats.orig_video_size_mb = res["orig_size_mb"]
        ctx.stats.clean_video_size_mb = res["clean_size_mb"]
        ctx.stats.video_saved_percent = res["saved_percent"]
        ctx.stats.video_encoder = res["encoder"]
        ctx.stats.av_drift_sec = round(res["duration_sec"] - ctx.clean_duration, 3)
        if abs(ctx.stats.av_drift_sec) > 0.5:
            ctx.warn(tr("step.av_drift", drift=ctx.stats.av_drift_sec))


class TranscribeStep(PipelineStep):
    """strict=False (inside processing): a failure (cloud unavailable, no key) becomes a warning and the lesson is saved
    with its clean audio and video; "Transcribe" in the lesson runs this step again (strict) without redoing the media."""

    stage = "transcribe"
    weight = 5
    together = "media"

    def __init__(self, strict: bool = False):
        self.strict = strict

    def enabled(self, ctx):
        return ctx.options.transcriber != "none"

    def may_overlap(self, ctx):
        """Next to the video encode only when recognition is not on the CPU: Gemini works in the cloud, and a GPU
        (CUDA, Apple) leaves the cores to FFmpeg (NVENC is a separate chip altogether). Whisper on the CPU and x264
        would only slow each other down."""
        if not super().may_overlap(ctx):
            return False
        if ctx.options.transcriber == "gemini":
            return True
        from backend.core import compute

        c = SettingsService.get().compute
        return compute.plan(c.device, c.cpu_threads, c.quiet).backend != "cpu"

    def execute(self, ctx, progress):
        try:
            self._transcribe(ctx, progress)
        except JobCancelled:
            raise
        except Exception as e:
            if self.strict:
                raise
            ctx.segments = []
            ctx.warn(tr("step.transcript_failed", error=e))
            logger.warning("transcription failed, lesson saved without it: %s", e, exc_info=True)

    def _transcribe(self, ctx, progress):
        o, ai = ctx.options, SettingsService.get().ai
        audio = ctx.speech_audio()

        def on_progress(f):
            return progress(f, tr("step.transcribe_pct", pct=int(f * 100)))

        if o.transcriber == "gemini":
            from backend.core.transcription import gemini

            key = SettingsService.api_key("gemini")
            if not key:
                raise ValueError(tr("ai.no_key", provider="Gemini"))
            if audio.endswith(".wav"):  # Eco: no MP3 of its own; the cloud gets a compact copy, not a 16 kHz WAV
                audio = str(encode_mp3(audio, ctx.work_dir / "speech.mp3"))
            progress(0, tr("step.transcribe_gemini", model=ai.gemini_model))
            raw = gemini.transcribe(
                audio, ctx.clean_duration, key, ai.gemini_model, ctx.work_dir, o.language, o.custom_vocabulary, ctx.check_cancelled, on_progress,
            )
        else:
            from backend.core import compute
            from backend.core.transcription import whisper

            c = SettingsService.get().compute
            plan = compute.plan(c.device, c.cpu_threads, c.quiet)
            where = {"cuda": f"GPU {plan.gpu_name}", "apple": "GPU Apple"}.get(plan.backend, tr("step.cpu_threads", n=plan.threads))
            progress(0, tr("step.transcribe_whisper", model=ai.whisper_model, where=where))
            raw = whisper.transcribe(
                audio, ctx.clean_duration, ai.whisper_model, o.language, o.custom_vocabulary, ctx.check_cancelled, on_progress, plan=plan,
            )

        ctx.segments = segments_from_clean(raw, ctx.time_map or TimeMap([]))
        write_transcripts(ctx.lesson_dir, ctx.segments)
        # the lecture's language: as set for the job, else read from the transcript (decides "recording" audits)
        ctx.speech_language = o.language if o.language in ("ru", "en") else language.detect(" ".join(s.text for s in ctx.segments))


class GenerateAuditStep(PipelineStep):
    """Audit by the chosen provider, from the transcript or (Gemini) from an optimized copy of the video.
    strict=False (inside processing): an AI failure becomes a warning, the lesson is still saved; a failed video
    analysis falls back to the transcript."""

    stage = "audit"
    weight = 3

    def __init__(self, strict: bool = False):
        self.strict = strict

    def enabled(self, ctx):
        return ctx.options.audit != "none"

    def execute(self, ctx, progress):
        o = ctx.options
        provider_name = o.audit
        if not AI.configured(provider_name):
            return self._fail(ctx, ValueError(AI.not_configured(provider_name)), tr("step.audit_no_key"))
        timed = o.audit_mode == "srt_timecodes"
        provider = AI.get(provider_name)
        lang = language.resolve(o.output_language, SettingsService.get().ui_language, ctx.speech_language)
        ctx.audit_language = lang
        if o.audit_source == "video":
            try:
                md = self._from_video(ctx, provider, timed, progress, lang)
                write_text(ctx.lesson_dir / Artifacts.AUDIT, md)
                return
            except JobCancelled:
                raise
            except Exception as e:
                if self.strict or not ctx.segments:
                    return self._fail(ctx, e, tr("step.audit_video_failed"))
                ctx.warn(tr("step.audit_video_fallback", error=e))
        if not ctx.segments:
            ctx.warn(tr("step.audit_empty_transcript"))
            return
        try:
            progress(0, tr("step.audit", provider=provider_name, model=provider.model))
            md = provider.generate_audit(compact_transcript(ctx.segments), ctx.clean_duration, timed, progress, language=lang)
        except JobCancelled:
            raise
        except Exception as e:
            return self._fail(ctx, e, tr("step.audit_failed"))
        write_text(ctx.lesson_dir / Artifacts.AUDIT, md)

    def _fail(self, ctx, error: Exception, label: str) -> None:
        if self.strict:
            raise error
        ctx.warn(f"{label}: {error}")

    @staticmethod
    def _from_video(ctx, provider, timed: bool, progress, lang: str) -> str:
        """The lesson's own video if it has one (already on the clean timeline), else the original recording."""
        if not getattr(provider, "can_watch_video", False):
            raise ValueError(tr("step.no_video_audit", provider=provider.category))
        source = LessonFiles.media(ctx.lesson, "video") if ctx.lesson else None
        if source is None:
            own = ctx.lesson_dir / Artifacts.VIDEO
            original = LessonFiles.original_of(ctx.lesson_dir, ctx.original_file) if ctx.original_file and ctx.original_kind == "video" else None
            source = own if own.is_file() else original
        if source is None or not Path(source).is_file():
            raise FileNotFoundError(tr("step.no_video_file"))
        progress(0, tr("step.video_proxy"))
        ctx.work_dir.mkdir(parents=True, exist_ok=True)  # Gemini transcription may have cleaned it up
        proxy = make_analysis_proxy(source, ctx.work_dir / "analysis.mp4")
        segments = ctx.segments

        def transcript_between(a: float, b: float) -> str:
            return compact_transcript([s for s in segments if a <= s.clean_start < b])

        return provider.generate_audit_from_video(proxy, ctx.clean_duration, timed, transcript_between, progress, ctx.check_cancelled, language=lang)


class SaveLessonStep(PipelineStep):
    stage = "save"
    weight = 0.5

    def execute(self, ctx, progress):
        progress(0, tr("step.save"))
        o = ctx.options
        base = ctx.lesson or Lesson(
            id=f"less_{ctx.job_id}",
            job_id=ctx.job_id,
            project_id=o.project_id,
            title=o.lesson_title.strip() or tr("lesson.default_title", id=ctx.job_id),
            notes=o.notes,
            status="in_progress" if ctx.segments else "to_review",
        )
        if not ctx.lesson:
            base = base.model_copy(update={
                "orig_duration_sec": ctx.stats.orig_duration_sec,
                "clean_duration_sec": ctx.stats.clean_duration_sec,
                "saved_percent": ctx.stats.saved_percent,
                "schema_version": SCHEMA_VERSION,
                "cut_silence": o.cut_silence,
                "original_file": ctx.original_file,
                "original_kind": ctx.original_kind,
            })
        base = base.model_copy(update={"speech_language": ctx.speech_language, "audit_language": ctx.audit_language})
        ctx.lesson = Lessons.save(base)

        if o.export_after and SettingsService.get().export_dir:
            from backend.services.export import export_lesson

            try:
                export_lesson(ctx.lesson.id, raw_wav=ctx.raw_wav)
            except Exception as e:
                ctx.warn(tr("step.export_failed", error=e))


PROCESS_STEPS: list[PipelineStep] = [
    ExtractAudioStep(),
    DetectSpeechStep(),
    BuildCleanAudioStep(),
    BuildVideoStep(),
    TranscribeStep(),
    GenerateAuditStep(),
    SaveLessonStep(),
]

AUDIT_STEPS: list[PipelineStep] = [GenerateAuditStep(strict=True), SaveLessonStep()]
TRANSCRIBE_STEPS: list[PipelineStep] = [TranscribeStep(strict=True), GenerateAuditStep(), SaveLessonStep()]
