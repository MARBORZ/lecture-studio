"""
User-editable settings schema (persisted to APP_HOME/settings.json).
"""

from typing import Literal

from pydantic import BaseModel, Field

ProcessingMode = Literal["deepseek", "gemini", "whisper", "audio_only"]
AuditMode = Literal["srt_timecodes", "clean_summary"]
VideoResolution = Literal["1080p", "720p", "original"]
AIProviderName = Literal["deepseek", "gemini"]
UILanguage = Literal["ru", "en"]
Theme = Literal["system", "dark", "light"]
TEXT_SCALE_MIN, TEXT_SCALE_MAX = 80, 150


class PipelineDefaults(BaseModel):
    """Default processing options. Every job starts from these and may override any field."""

    min_silence_ms: int = Field(800, ge=100, le=5000)
    speech_pad_ms: int = Field(250, ge=0, le=1000)
    vad_threshold: float = Field(0.5, ge=0.1, le=0.95)
    enhance_audio: bool = False
    clean_video: bool = True
    video_resolution: VideoResolution = "1080p"
    video_crf: int = Field(26, ge=18, le=36)
    mode: ProcessingMode = "deepseek"
    language: str = "auto"
    custom_vocabulary: str = ""
    generate_audit: bool = True
    audit_mode: AuditMode = "srt_timecodes"


class AISettings(BaseModel):
    deepseek_api_key: str = ""
    gemini_api_key: str = ""
    deepseek_model: str = "deepseek-chat"
    gemini_model: str = "gemini-3.5-flash"
    whisper_model: str = "large-v3-turbo"
    assistant_provider: AIProviderName = "deepseek"


class AppSettings(BaseModel):
    data_dir: str
    export_dir: str = ""
    ui_language: UILanguage = "ru"
    onboarding_done: bool = False  # first-run tutorial passed (false -> the UI shows it before anything else)
    theme: Theme = "system"  # follows the OS by default
    text_scale: int = Field(100, ge=TEXT_SCALE_MIN, le=TEXT_SCALE_MAX)  # % of the base size of reading text
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


class TranscriptionDevice(BaseModel):
    """Where local Whisper runs. reason (cpu only): apple | torch_cpu | no_gpu | cuda_failed: <error>."""

    device: Literal["cuda", "cpu"]
    name: str = ""
    reason: str = ""
