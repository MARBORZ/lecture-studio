"""
Settings persistence and data-path resolution.

Settings are read from APP_HOME/settings.json on every access through a small mtime cache,
so the API server, the MCP server and the launcher always see the same values.
"""

import os
import shutil
import threading
from dataclasses import dataclass
from pathlib import Path

from backend.config import APP_HOME, DEFAULT_DATA_DIR, LOGS_DIR, SETTINGS_FILE
from backend.i18n import tr
from backend.settings import hotkeys
from backend.settings.schema import (
    AISettingsView,
    AppSettings,
    HotkeyView,
    KeyStatus,
    PathCheckResult,
    PathsView,
    SettingsPatch,
    SettingsView,
)
from backend.utils.fs import read_json, to_path, write_json

DB_FILENAME = "notebook_db.json"

ENV_KEYS = {"deepseek": "DEEPSEEK_API_KEY", "gemini": "GEMINI_API_KEY", "openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}


@dataclass(frozen=True)
class Paths:
    """All data locations derived from a single data_dir."""

    data_dir: Path

    @property
    def db(self) -> Path:
        return self.data_dir / DB_FILENAME

    @property
    def output(self) -> Path:
        return self.data_dir / "output"

    @property
    def temp(self) -> Path:
        return self.data_dir / "temp"

    @property
    def diary(self) -> Path:
        return self.data_dir / "diary"

    @property
    def attachments(self) -> Path:
        return self.data_dir / "attachments"

    @property
    def covers(self) -> Path:
        return self.data_dir / "covers"

    @property
    def sessions(self) -> Path:
        """Assistant sessions: <id>/context/session.json and <id>/local_session_src/ (its files)."""
        return self.data_dir / "sessions"

    @property
    def downloads(self) -> Path:
        """Videos downloaded in the Videos tab (services/videos.py), before the Studio makes lessons of them."""
        return self.data_dir / "downloads"

    @property
    def job_history(self) -> Path:
        """Finished jobs (services/jobs.py): the Studio's history survives restarts."""
        return self.data_dir / "job_history.json"

    def movable(self) -> list[Path]:
        """What "move the library" carries to a new data folder (temp is dropped)."""
        return [self.db, self.output, self.diary, self.attachments, self.covers, self.sessions, self.downloads, self.job_history]

    def lesson_dir(self, job_id: str) -> Path:
        return self.output / job_id

    def ensure(self) -> "Paths":
        for d in (self.data_dir, self.output, self.temp):
            d.mkdir(parents=True, exist_ok=True)
        return self


class SettingsService:
    _lock = threading.RLock()
    _cache: AppSettings | None = None
    _cache_mtime: float = -1.0

    # ---------- load / save ----------

    @classmethod
    def get(cls) -> AppSettings:
        with cls._lock:
            mtime = SETTINGS_FILE.stat().st_mtime if SETTINGS_FILE.exists() else -1.0
            if cls._cache is not None and mtime == cls._cache_mtime:
                return cls._cache

            raw = read_json(SETTINGS_FILE, default=None)
            if isinstance(raw, dict):
                settings = AppSettings.model_validate(raw)
            else:
                settings = cls._initial()
                cls._save(settings)
                mtime = SETTINGS_FILE.stat().st_mtime

            cls._cache, cls._cache_mtime = settings, mtime
            return settings

    @classmethod
    def _save(cls, settings: AppSettings) -> None:
        APP_HOME.mkdir(parents=True, exist_ok=True)
        write_json(SETTINGS_FILE, settings.model_dump())
        os.chmod(SETTINGS_FILE, 0o600)  # holds API keys
        cls._cache = settings
        cls._cache_mtime = SETTINGS_FILE.stat().st_mtime

    @staticmethod
    def _initial() -> AppSettings:
        settings = AppSettings(data_dir=str(DEFAULT_DATA_DIR))
        for env_name, field in (
            ("DEFAULT_DEEPSEEK_MODEL", "deepseek_model"),
            ("DEFAULT_GEMINI_MODEL", "gemini_model"),
            ("DEFAULT_WHISPER_MODEL", "whisper_model"),
        ):
            if os.getenv(env_name):
                setattr(settings.ai, field, os.environ[env_name])
        return settings

    @classmethod
    def patch(cls, patch: SettingsPatch) -> AppSettings:
        with cls._lock:
            current = cls.get().model_copy(deep=True)
            if patch.export_dir is not None:
                current.export_dir = str(to_path(patch.export_dir)) if patch.export_dir.strip() else ""
            if patch.ui_language is not None:
                current.ui_language = patch.ui_language
            if patch.onboarding_done is not None:
                current.onboarding_done = patch.onboarding_done
            if patch.theme is not None:
                current.theme = patch.theme
            if patch.text_scale is not None:
                current.text_scale = patch.text_scale
            if patch.boot_animation is not None:
                current.boot_animation = patch.boot_animation
            if patch.video_terms_accepted is not None:
                current.video_terms_accepted = patch.video_terms_accepted
            if patch.beta_updates is not None:
                current.beta_updates = patch.beta_updates
            if patch.queue_limit is not None:
                current.queue_limit = patch.queue_limit
            if patch.compute is not None:
                current.compute = patch.compute
            if patch.pipeline is not None:
                current.pipeline = patch.pipeline
            if patch.hotkeys:
                current.hotkeys = hotkeys.apply(current.hotkeys, patch.hotkeys)  # HotkeyError: nothing is saved
            if patch.ai is not None:
                for field, value in patch.ai.model_dump(exclude_none=True, exclude={"context_tokens"}).items():
                    setattr(current.ai, field, value.strip() if isinstance(value, str) else value)
                for provider, tokens in (patch.ai.context_tokens or {}).items():
                    if tokens is None:
                        current.ai.context_tokens.pop(provider, None)
                    else:
                        current.ai.context_tokens[provider] = tokens
            cls._save(current)
            return current

    @classmethod
    def set_prompt(cls, key: str, value: str | None) -> AppSettings:
        """Store an override for an editable prompt block; None/blank resets it to the default."""
        with cls._lock:
            current = cls.get().model_copy(deep=True)
            if value and value.strip():
                current.prompts[key] = value.strip() + "\n"
            else:
                current.prompts.pop(key, None)
            cls._save(current)
            return current

    # ---------- paths ----------

    @classmethod
    def paths(cls) -> Paths:
        return Paths(to_path(cls.get().data_dir))

    @staticmethod
    def check_path(path: str) -> PathCheckResult:
        p = to_path(path)
        result = PathCheckResult(path=str(p), exists=p.exists(), is_dir=p.is_dir(), writable=False, has_library=False)
        if result.exists and not result.is_dir:
            result.error = tr("path.is_file")
            return result
        probe_dir = p if p.exists() else next((a for a in p.parents if a.exists()), None)
        result.writable = bool(probe_dir and os.access(probe_dir, os.W_OK))
        if not result.writable:
            result.error = tr("path.no_write")
        db = read_json(p / DB_FILENAME, default=None) if p.is_dir() else None
        if isinstance(db, dict):
            result.has_library = True
            result.lesson_count = len(db.get("lessons") or [])
        return result

    @classmethod
    def change_data_dir(cls, new_path: str, move: bool) -> AppSettings:
        """Switch data_dir. With move=True the current library is moved into the new folder."""
        with cls._lock:
            check = cls.check_path(new_path)
            if check.error:
                raise ValueError(check.error)
            target = to_path(new_path)
            source = cls.paths().data_dir
            if target == source:
                return cls.get()

            if move:
                if check.has_library:
                    raise ValueError(tr("path.library_exists"))
                target.mkdir(parents=True, exist_ok=True)
                for src in Paths(source).movable():
                    if src.exists():
                        shutil.move(str(src), str(target / src.name))
                shutil.rmtree(Paths(source).temp, ignore_errors=True)

            current = cls.get().model_copy(deep=True)
            current.data_dir = str(target)
            cls._save(current)
            Paths(target).ensure()
            return current

    # ---------- AI keys ----------

    @classmethod
    def api_key(cls, provider: str) -> str:
        stored = getattr(cls.get().ai, f"{provider}_api_key", "") or ""
        return stored or os.getenv(ENV_KEYS.get(provider, ""), "")

    @classmethod
    def _key_status(cls, provider: str) -> KeyStatus:
        stored = getattr(cls.get().ai, f"{provider}_api_key", "") or ""
        env = os.getenv(ENV_KEYS[provider], "")
        key, source = (stored, "settings") if stored else ((env, "env") if env else ("", "none"))
        hint = f"{key[:3]}…{key[-4:]}" if len(key) > 10 else ""
        return KeyStatus(source=source, hint=hint)

    # ---------- view ----------

    @classmethod
    def view(cls) -> SettingsView:
        s = cls.get()
        p = cls.paths()
        return SettingsView(
            ui_language=s.ui_language,
            onboarding_done=s.onboarding_done,
            theme=s.theme,
            text_scale=s.text_scale,
            boot_animation=s.boot_animation,
            video_terms_accepted=s.video_terms_accepted,
            beta_updates=s.beta_updates,
            queue_limit=s.queue_limit,
            compute=s.compute,
            paths=PathsView(
                data_dir=str(p.data_dir),
                export_dir=s.export_dir,
                app_home=str(APP_HOME),
                db_file=str(p.db),
                output_dir=str(p.output),
                temp_dir=str(p.temp),
                logs_dir=str(LOGS_DIR),
            ),
            ai=AISettingsView(
                deepseek_key=cls._key_status("deepseek"),
                gemini_key=cls._key_status("gemini"),
                openai_key=cls._key_status("openai"),
                anthropic_key=cls._key_status("anthropic"),
                deepseek_model=s.ai.deepseek_model,
                gemini_model=s.ai.gemini_model,
                openai_model=s.ai.openai_model,
                anthropic_model=s.ai.anthropic_model,
                whisper_model=s.ai.whisper_model,
                local_base_url=s.ai.local_base_url,
                local_model=s.ai.local_model,
                assistant_provider=s.ai.assistant_provider,
                context_tokens=s.ai.context_tokens,
            ),
            pipeline=s.pipeline,
            hotkeys=[
                HotkeyView(id=aid, scope=a.scope, default=a.default, combo=hotkeys.effective(s.hotkeys)[aid])
                for aid, a in hotkeys.ACTIONS.items()
            ],
        )


def paths() -> Paths:
    """Shortcut used across the backend."""
    return SettingsService.paths()
