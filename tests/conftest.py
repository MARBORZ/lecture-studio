import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


@pytest.fixture(autouse=True)
def no_real_api_keys(monkeypatch):
    """Tests never see the developer's keys (.env is loaded by backend.config): no test may reach a real AI API."""
    import os

    for name in list(os.environ):
        if name.endswith("_API_KEY"):
            monkeypatch.delenv(name, raising=False)


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
