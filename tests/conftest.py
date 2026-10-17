import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


@pytest.fixture(autouse=True)
def russian_ui(monkeypatch):
    """Server texts (backend.i18n) in Russian whatever the developer's own settings say; a test switches with
    monkeypatch.setattr(i18n, "lang", lambda: "en"), or restores i18n.REAL_LANG to follow the settings."""
    from backend import i18n

    i18n.REAL_LANG = getattr(i18n, "REAL_LANG", i18n.lang)
    monkeypatch.setattr(i18n, "lang", lambda: "ru")


@pytest.fixture(autouse=True)
def no_real_feedback(monkeypatch):
    """No test mails the developer: the feedback relay is off unless a test sets its own URL."""
    import backend.config as config

    monkeypatch.setattr(config, "FEEDBACK_URL", "")


@pytest.fixture(autouse=True)
def no_real_api_keys(monkeypatch):
    """Tests never see the developer's keys (.env is loaded by backend.config): no test may reach a real AI API."""
    import os

    for name in list(os.environ):
        if name.endswith("_API_KEY"):
            monkeypatch.delenv(name, raising=False)


@pytest.fixture(autouse=True)
def no_real_claude(monkeypatch):
    """No test asks the developer's own `claude` whether it is signed in; a test of the check restores
    claude_code.REAL_ASK_STATUS and points LECTURE_STUDIO_CLAUDE_BIN at a fake."""
    from backend.core.ai.providers import claude_code

    claude_code.REAL_ASK_STATUS = getattr(claude_code, "REAL_ASK_STATUS", claude_code._ask_status)
    monkeypatch.setattr(claude_code, "_ask_status", lambda: False)
    monkeypatch.setattr(claude_code, "_status", None)


@pytest.fixture()
def data_dir(tmp_path, monkeypatch):
    """Isolated APP_HOME + data_dir for every test."""
    home = tmp_path / "home"
    data = tmp_path / "data"
    home.mkdir()
    (data / "output").mkdir(parents=True)
    (home / "settings.json").write_text(json.dumps({"data_dir": str(data)}))
    monkeypatch.setenv("LECTURE_STUDIO_HOME", str(home))

    import backend.config as config
    import backend.settings.service as service

    monkeypatch.setattr(service, "SETTINGS_FILE", home / "settings.json")
    monkeypatch.setattr(service, "APP_HOME", home)
    monkeypatch.setattr(config, "PID_FILE", home / "server.pid")
    service.SettingsService._cache = None
    yield data
    service.SettingsService._cache = None


TIME_MAP = [
    {"segment_index": 0, "orig_start": 2.0, "orig_end": 12.0, "clean_start": 0.0, "clean_end": 10.0},
    {"segment_index": 1, "orig_start": 20.0, "orig_end": 30.0, "clean_start": 10.0, "clean_end": 20.0},
    {"segment_index": 2, "orig_start": 100.0, "orig_end": 110.0, "clean_start": 20.0, "clean_end": 30.0},
]
