"""
User-editable settings schema (persisted to APP_HOME/settings.json).
"""

from typing import Literal

from pydantic import BaseModel, Field, model_validator

AuditMode = Literal["srt_timecodes", "clean_summary"]
VideoResolution = Literal["1080p", "720p", "original"]
AIProviderName = Literal["deepseek", "gemini"]
UILanguage = Literal["ru", "en"]
Theme = Literal["system", "dark", "light"]
TEXT_SCALE_MIN, TEXT_SCALE_MAX = 80, 150


Transcriber = Literal["whisper", "gemini", "none"]
AuditProvider = Literal["deepseek", "gemini", "none"]
AuditSource = Literal["transcript", "video"]  # video = Gemini watches an optimized copy (costs more, sees the screen)
VideoOutput = Literal["clean", "compressed", "original", "none"]
# clean      — jump-cut video (the pauses cut out like in the audio); without cut_silence it equals "compressed"
# compressed — the whole video re-encoded smaller (H.264), nothing cut
# original   — the file itself, untouched: a path on disk stays where it is (Eco mode), an upload moves into the lesson;
#              implies cut_silence = False (the timeline must be the file's) and no separate audio file
# none       — sound only


class PipelineDefaults(BaseModel):
    """Processing options, one field per step. Every job starts from these and may override any field.
    Older settings ("mode", "clean_video", "generate_audit") are read and translated."""

    cut_silence: bool = True
    min_silence_ms: int = Field(800, ge=100, le=5000)
    speech_pad_ms: int = Field(250, ge=0, le=1000)
    vad_threshold: float = Field(0.5, ge=0.1, le=0.95)
    enhance_audio: bool = False
    video: VideoOutput = "clean"
    video_resolution: VideoResolution = "1080p"
    video_crf: int = Field(26, ge=18, le=36)
    transcriber: Transcriber = "whisper"
    language: str = "auto"
    custom_vocabulary: str = ""
    audit: AuditProvider = "deepseek"
    audit_source: AuditSource = "transcript"
    audit_mode: AuditMode = "srt_timecodes"

    @model_validator(mode="before")
    @classmethod
    def _legacy(cls, data):
        """settings.json from 1.x before 1.4: one "mode" for both transcription and audit, video on/off."""
        if not isinstance(data, dict) or "mode" not in data and "clean_video" not in data and "generate_audit" not in data:
            return data
        data = dict(data)
        mode = data.pop("mode", "deepseek")
        generate = data.pop("generate_audit", True)
        clean = data.pop("clean_video", True)
        data.setdefault("transcriber", {"gemini": "gemini", "audio_only": "none"}.get(mode, "whisper"))
        data.setdefault("audit", "none" if mode == "audio_only" or not generate else ("gemini" if mode == "gemini" else "deepseek"))
        data.setdefault("video", "clean" if clean else "none")
        return data

    @model_validator(mode="after")
    def _consistent(self):
        """Combinations that cannot work are made to: the result is what will actually run."""
        if self.video == "original":
            self.cut_silence = False  # the file's own timeline
        if self.video == "clean" and not self.cut_silence:
            self.video = "compressed"
        if self.audit == "none" or (self.audit_source == "video" and (self.audit != "gemini" or self.video == "none")):
            self.audit_source = "transcript"  # video analysis needs Gemini and a video
        if self.transcriber == "none" and self.audit_source == "transcript":
            self.audit = "none"  # nothing to write an audit from
        return self

    @property
    def keeps_audio_file(self) -> bool:
        return self.video != "original"


class AISettings(BaseModel):
    deepseek_api_key: str = ""
    gemini_api_key: str = ""
    deepseek_model: str = "deepseek-chat"
    gemini_model: str = "gemini-3.5-flash"
    whisper_model: str = "large-v3-turbo"
    assistant_provider: AIProviderName = "deepseek"


ComputePreference = Literal["auto", "gpu", "cpu"]


class ComputeSettings(BaseModel):
    """Where local models (Whisper) run. auto = the GPU when there is a usable one (NVIDIA CUDA, Apple GPU)."""

    device: ComputePreference = "auto"
    cpu_threads: int = Field(0, ge=0, le=256)  # 0 = every physical core


class ComputeStatus(BaseModel):
    """What the next local transcription will run on, and why (Settings → AI)."""

    preference: ComputePreference
    backend: Literal["cuda", "apple", "cpu"]
    gpu_name: str = ""  # the usable GPU, also when the CPU is chosen
    gpu_available: bool
    reason: str = ""  # cpu only: user | no_gpu | old_gpu | old_driver | torch_cpu | apple_unavailable | gpu_failed
    failure: str = ""  # the GPU error behind gpu_failed
    threads: int
    cores: int
    logical_cores: int


class AppSettings(BaseModel):
    data_dir: str
    export_dir: str = ""
    ui_language: UILanguage = "ru"
    onboarding_done: bool = False  # first-run tutorial passed (false -> the UI shows it before anything else)
    theme: Theme = "system"  # follows the OS by default
    text_scale: int = Field(100, ge=TEXT_SCALE_MIN, le=TEXT_SCALE_MAX)  # % of the base size of reading text
    beta_updates: bool = False  # offer pre-releases (vX.Y.Z-beta.N) too, not only releases
    compute: ComputeSettings = Field(default_factory=ComputeSettings)
    ai: AISettings = Field(default_factory=AISettings)
    pipeline: PipelineDefaults = Field(default_factory=PipelineDefaults)
    prompts: dict[str, str] = Field(default_factory=dict)  # overrides of editable prompt blocks only


# ---------- API views ----------

KeySource = Literal["settings", "env", "none"]


class KeyStatus(BaseModel):
    source: KeySource
    hint: str = ""  # e.g. "sk-…a1b2"; never the full key


class AISettingsView(BaseModel):
    deepseek_key: KeyStatus
    gemini_key: KeyStatus
    deepseek_model: str
    gemini_model: str
    whisper_model: str
    assistant_provider: AIProviderName


class PathsView(BaseModel):
    data_dir: str
    export_dir: str
    app_home: str
    db_file: str
    output_dir: str
    temp_dir: str
    logs_dir: str


class SettingsView(BaseModel):
    ui_language: UILanguage
    onboarding_done: bool
    theme: Theme
    text_scale: int
    beta_updates: bool
    compute: ComputeSettings
    paths: PathsView
    ai: AISettingsView
    pipeline: PipelineDefaults


class AISettingsPatch(BaseModel):
    # None = unchanged, "" = clear stored key (falls back to .env)
    deepseek_api_key: str | None = None
    gemini_api_key: str | None = None
    deepseek_model: str | None = None
    gemini_model: str | None = None
    whisper_model: str | None = None
    assistant_provider: AIProviderName | None = None


class SettingsPatch(BaseModel):
    export_dir: str | None = None
    ui_language: UILanguage | None = None
    onboarding_done: bool | None = None
    theme: Theme | None = None
    text_scale: int | None = Field(default=None, ge=TEXT_SCALE_MIN, le=TEXT_SCALE_MAX)
    beta_updates: bool | None = None
    compute: ComputeSettings | None = None
    ai: AISettingsPatch | None = None
    pipeline: PipelineDefaults | None = None


class PathCheckRequest(BaseModel):
    path: str


class PathCheckResult(BaseModel):
    path: str
    exists: bool
    is_dir: bool
    writable: bool
    has_library: bool  # contains notebook_db.json
    lesson_count: int = 0
    error: str = ""


class PromptView(BaseModel):
    key: str
    group: Literal["audit", "assistant"]
    title: str
    hint: str
    default: str
    value: str
    modified: bool


class PromptUpdate(BaseModel):
    value: str = Field(min_length=1, max_length=20_000)


class KeyTestRequest(BaseModel):
    provider: AIProviderName


class KeyTestResult(BaseModel):
    ok: bool
    model: str
    error: str = ""


class DataDirChange(BaseModel):
    path: str
    mode: Literal["attach", "move"] = "attach"

