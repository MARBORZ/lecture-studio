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
from backend.settings.schema import (
    AISettingsView,
    AppSettings,
    KeyStatus,
    PathCheckResult,
    PathsView,
    SettingsPatch,
    SettingsView,
)
from backend.utils.fs import read_json, to_path, write_json

DB_FILENAME = "notebook_db.json"

ENV_KEYS = {"deepseek": "DEEPSEEK_API_KEY", "gemini": "GEMINI_API_KEY"}


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

    def movable(self) -> list[Path]:
        """What "move the library" carries to a new data folder (temp is dropped)."""
        return [self.db, self.output, self.diary, self.attachments, self.covers]

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
            if patch.compute is not None:
                current.compute = patch.compute
            if patch.pipeline is not None:
                current.pipeline = patch.pipeline
            if patch.ai is not None:
                for field, value in patch.ai.model_dump(exclude_none=True).items():
                    setattr(current.ai, field, value.strip() if isinstance(value, str) else value)
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
            result.error = "Путь указывает на файл, а не на папку"
            return result
        probe_dir = p if p.exists() else next((a for a in p.parents if a.exists()), None)
        result.writable = bool(probe_dir and os.access(probe_dir, os.W_OK))
        if not result.writable:
            result.error = "Нет прав на запись"
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
                    raise ValueError("В целевой папке уже есть библиотека — выберите «Подключить»")
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
                deepseek_model=s.ai.deepseek_model,
                gemini_model=s.ai.gemini_model,
                whisper_model=s.ai.whisper_model,
                assistant_provider=s.ai.assistant_provider,
            ),
            pipeline=s.pipeline,
        )


def paths() -> Paths:
    """Shortcut used across the backend."""
    return SettingsService.paths()
