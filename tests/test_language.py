"""
Prompts are English; the audit is written in the chosen language: the interface's, the lecture's, or an explicit one.
"""

import re

from backend.core import language
from backend.core.ai import prompts


def test_detect_and_resolve():
    assert language.detect("Параметр — это имя в объявлении функции, аргумент — значение при вызове.") == "ru"
    assert language.detect("A parameter is the name in the definition, an argument is the value passed in.") == "en"
    assert language.detect("ok") == ""  # too little to tell
    assert language.resolve("interface", "ru", "en") == "ru"
    assert language.resolve("recording", "ru", "en") == "en"
    assert language.resolve("recording", "ru", "") == "ru"  # unknown speech -> interface
    assert language.resolve("en", "ru", "ru") == "en"


def test_default_prompts_are_english_and_name_the_output_language():
    for block in prompts.BLOCKS.values():
        assert not re.search(r"[А-Яа-яЁё]", block.default), block.key
    system = prompts.audit_system(True, "ru")
    assert "Write everything in Russian" in system and "[MM:SS]" in system
    assert "Answer in the language of the user's question" in prompts.assistant_system("qa", False, "ru")
    assert prompts.default_question("quiz", "ru").startswith("Сделай") and prompts.default_question("quiz", "en").startswith("Make")


def test_audit_follows_the_chosen_language(data_dir, monkeypatch):
    import time

    from fastapi.testclient import TestClient

    from backend.core.pipeline import steps
    from backend.main import app
    from backend.models.lesson import Lesson
    from backend.services.storage import Lessons
    from backend.utils.fs import write_json

    seen = []

    class Provider:
        category, model = "deepseek", "fake"

        def generate_audit(self, transcript, duration, timed, progress, language="en"):
            seen.append(language)
            return "# Audit"

    monkeypatch.setattr(steps.AI, "get", staticmethod(lambda name: Provider()))
    monkeypatch.setattr(steps.SettingsService, "api_key", classmethod(lambda cls, name: "key"))
    Lessons.save(Lesson(id="less_l", job_id="l", title="Lesson", speech_language="en"))
    write_json(data_dir / "output" / "l" / "segments.json", [{"clean_start": 0, "clean_end": 2, "orig_start": 0, "orig_end": 2, "text": "hello"}])

    def regenerate(c, lang):
        job = c.post("/api/lessons/less_l/audit", json={"provider": "deepseek", "language": lang}).json()
        while c.get(f"/api/jobs/{job['id']}").json()["status"] not in ("completed", "error"):
            time.sleep(0.05)

    with TestClient(app, base_url="http://127.0.0.1") as c:
        c.patch("/api/settings", json={"ui_language": "ru"})
        regenerate(c, "interface")
        regenerate(c, "recording")
        lesson = c.get("/api/lessons/less_l").json()
    assert seen == ["ru", "en"] and lesson["audit_language"] == "en" and lesson["speech_language"] == "en"
