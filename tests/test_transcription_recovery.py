"""
A failed transcription does not throw the processed media away, and can be redone alone from the lesson.
"""

import time

from fastapi.testclient import TestClient

from backend.i18n import tr


def wait(c, job_id, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        job = c.get(f"/api/jobs/{job_id}").json()
        if job["status"] in ("completed", "error", "cancelled"):
            return job
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def test_soft_transcription_failure_keeps_the_lesson(data_dir, monkeypatch):
    from backend.core.pipeline.steps import JobContext, TranscribeStep
    from backend.core.transcription import whisper
    from backend.models.job import JobOptions

    failure = RuntimeError("Gemini is overloaded (503)")

    def boom(*a, **k):
        raise failure

    monkeypatch.setattr(whisper, "transcribe", boom)
    ctx = JobContext("j1", JobOptions(mode="whisper"))
    ctx.raw_wav.parent.mkdir(parents=True, exist_ok=True)
    ctx.raw_wav.write_bytes(b"")  # audio is there: the recognition itself fails
    TranscribeStep().execute(ctx, lambda f, m: None)
    assert ctx.segments == [] and tr("step.transcript_failed", error=failure) in ctx.warning


def test_transcribe_an_existing_lesson_again(data_dir, monkeypatch):
    from backend.core.transcription import whisper
    from backend.main import app
    from backend.models.lesson import Lesson
    from backend.services.storage import Lessons

    Lessons.save(Lesson(id="less_r", job_id="r", title="Урок", clean_duration_sec=10))
    lesson_dir = data_dir / "output" / "r"
    lesson_dir.mkdir(parents=True, exist_ok=True)
    (lesson_dir / "clean_speech.mp3").write_bytes(b"ID3")
    monkeypatch.setattr(whisper, "transcribe", lambda *a, **k: [{"clean_start": 0.0, "clean_end": 2.0, "text": "параметр и аргумент"}])

    with TestClient(app, base_url="http://127.0.0.1") as c:
        assert c.post("/api/lessons/less_r/transcribe", json={"transcriber": "gemini"}).status_code == 400  # no Gemini key
        job = wait(c, c.post("/api/lessons/less_r/transcribe", json={"transcriber": "whisper"}).json()["id"])
        assert job["status"] == "completed", job
        full = c.get("/api/lessons/less_r").json()
    assert full["has_transcription"] and full["segments"][0]["text"] == "параметр и аргумент"
