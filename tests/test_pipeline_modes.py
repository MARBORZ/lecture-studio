"""
Every processing step can be switched on or off: silence cutting, video (clean / compressed / original / none),
transcription and audit (from the transcript or from the video). Real FFmpeg on small generated files.
"""

import shutil
import subprocess
import time

import pytest
from fastapi.testclient import TestClient

from backend.core.media import ffmpeg_available

pytestmark = pytest.mark.skipif(not ffmpeg_available(), reason="needs ffmpeg")


def make_clip(path, seconds=4):
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc=size=320x240:rate=25:d={seconds}",
         "-f", "lavfi", "-i", f"sine=frequency=440:d={seconds}", "-c:v", "libx264", "-c:a", "aac", "-shortest", str(path)],
        check=True,
    )
    return path


def run_job(c, options, timeout=60):
    r = c.post("/api/jobs", json={"options": options})
    assert r.status_code == 200, r.text
    end = time.time() + timeout
    while time.time() < end:
        job = c.get(f"/api/jobs/{r.json()['id']}").json()
        if job["status"] in ("completed", "error", "cancelled"):
            return job
        time.sleep(0.1)
    raise AssertionError("job did not finish")


def test_old_settings_are_translated():
    from backend.settings.schema import PipelineDefaults as P

    assert (P(mode="gemini").transcriber, P(mode="gemini").audit) == ("gemini", "gemini")
    old = P(mode="audio_only", clean_video=False)
    assert (old.transcriber, old.audit, old.video) == ("none", "none", "none")
    assert (P(mode="whisper", generate_audit=False).audit) == "none"


def test_impossible_combinations_become_possible():
    from backend.settings.schema import PipelineDefaults as P

    assert P(video="original", cut_silence=True).cut_silence is False  # the file's own timeline
    assert P(video="clean", cut_silence=False).video == "compressed"
    assert P(audit="deepseek", audit_source="video").audit_source == "transcript"  # video analysis is Gemini's
    assert P(transcriber="none", audit="deepseek").audit == "none"  # nothing to audit from
    assert P(transcriber="none", audit="gemini", audit_source="video").audit == "gemini"  # the video alone is enough


def test_eco_mode_keeps_the_original_where_it_is(data_dir, tmp_path):
    from backend.main import app
    from backend.services.storage import Artifacts

    clip = make_clip(tmp_path / "lecture.mp4")
    with TestClient(app) as c:
        job = run_job(c, {"local_path": str(clip), "video": "original", "transcriber": "none", "audit": "none", "lesson_title": "Eco"})
        assert job["status"] == "completed", job
        lesson = c.get(f"/api/lessons/{job['lesson_id']}").json()
        assert lesson["original_file"] == str(clip.resolve()) and lesson["original_kind"] == "video"
        assert lesson["cut_silence"] is False and lesson["video_url"] and lesson["audio_url"] and not lesson["source_missing"]
        lesson_dir = data_dir / "output" / lesson["job_id"]
        assert not (lesson_dir / Artifacts.AUDIO).exists() and not (lesson_dir / Artifacts.VIDEO).exists()  # nothing copied
        assert clip.exists()  # the source is never touched
        assert c.get(lesson["video_url"]).content == clip.read_bytes()  # the player plays the original

        moved = tmp_path / "moved" / "lecture.mp4"
        moved.parent.mkdir()
        shutil.move(clip, moved)
        assert c.get(f"/api/lessons/{lesson['id']}").json()["source_missing"] is True

        other = make_clip(tmp_path / "other.mp4", seconds=9)
        assert c.post(f"/api/lessons/{lesson['id']}/relink", json={"path": str(other)}).status_code == 400  # another recording
        assert c.post(f"/api/lessons/{lesson['id']}/relink", json={"path": str(moved)}).status_code == 200
        assert c.get(f"/api/lessons/{lesson['id']}").json()["source_missing"] is False


def test_uploaded_original_moves_into_the_lesson(data_dir, tmp_path):
    from backend.main import app

    clip = make_clip(tmp_path / "rec.mp4")
    with TestClient(app) as c:
        up = c.put("/api/uploads/rec.mp4", content=clip.read_bytes()).json()
        r = c.post("/api/jobs", json={"options": {"video": "original", "transcriber": "none", "audit": "none"}, "upload_id": up["upload_id"]})
        job_id = r.json()["id"]
        end = time.time() + 60
        while (job := c.get(f"/api/jobs/{job_id}").json())["status"] not in ("completed", "error") and time.time() < end:
            time.sleep(0.1)
        lesson = c.get(f"/api/lessons/{job['lesson_id']}").json()
    assert lesson["original_file"] == "original.mp4"  # inside the lesson folder: the upload was the only copy
    assert (data_dir / "output" / lesson["job_id"] / "original.mp4").is_file()


def test_compressed_without_cutting(data_dir, tmp_path):
    from backend.main import app
    from backend.services.storage import Artifacts

    clip = make_clip(tmp_path / "talk.mp4")
    with TestClient(app) as c:
        job = run_job(c, {"local_path": str(clip), "cut_silence": False, "video": "compressed", "transcriber": "none", "audit": "none"})
        assert job["status"] == "completed", job
        assert "vad" not in job["stages"]  # the silence step did not run
        lesson = c.get(f"/api/lessons/{job['lesson_id']}").json()
    lesson_dir = data_dir / "output" / lesson["job_id"]
    assert (lesson_dir / Artifacts.AUDIO).is_file() and (lesson_dir / Artifacts.VIDEO).is_file()
    assert abs(lesson["clean_duration_sec"] - lesson["orig_duration_sec"]) < 0.1 and lesson["cut_silence"] is False


def test_audit_from_video_and_its_fallback(data_dir, tmp_path, monkeypatch):
    from backend.core.pipeline import steps
    from backend.main import app

    clip = make_clip(tmp_path / "screen.mp4")
    seen = {}

    class Gemini:
        category, model, can_watch_video = "gemini", "fake", True

        def generate_audit_from_video(self, proxy, duration, timed, transcript_between, progress, cancel):
            seen["proxy"] = proxy
            seen["transcript"] = transcript_between(0, duration)
            return "# По видео\\n\\n- кадр [00:01]"

        def generate_audit(self, transcript, duration, timed, progress):
            return "# По стенограмме"

    monkeypatch.setattr(steps.AI, "get", staticmethod(lambda name: Gemini()))
    monkeypatch.setattr(steps.SettingsService, "api_key", classmethod(lambda cls, name: "key"))
    with TestClient(app) as c:
        options = {"local_path": str(clip), "cut_silence": False, "video": "compressed", "transcriber": "none"}
        job = run_job(c, {**options, "audit": "gemini", "audit_source": "video"})
        assert job["status"] == "completed", job
        audit = c.get(f"/api/lessons/{job['lesson_id']}").json()["lesson_audit_md"]
    assert audit.startswith("# По видео") and str(seen["proxy"]).endswith("analysis.mp4") and seen["transcript"] == ""


def test_drop_video_keeps_the_sound(data_dir, tmp_path):
    from backend.main import app
    from backend.services.storage import Artifacts

    clip = make_clip(tmp_path / "a.mp4")
    with TestClient(app) as c:
        # a regular lesson: its video copy goes, the sound stays
        job = run_job(c, {"local_path": str(clip), "cut_silence": False, "video": "compressed", "transcriber": "none", "audit": "none"})
        lid = job["lesson_id"]
        c.post(f"/api/lessons/{lid}/drop-video")
        full = c.get(f"/api/lessons/{lid}").json()
        assert full["video_url"] is None and full["audio_url"] and not full["has_video"]
        assert not (data_dir / "output" / full["job_id"] / Artifacts.VIDEO).exists()

        # Eco: the user's own file is never deleted, the lesson only stops showing the picture
        job = run_job(c, {"local_path": str(clip), "video": "original", "transcriber": "none", "audit": "none"})
        c.post(f"/api/lessons/{job['lesson_id']}/drop-video")
        eco = c.get(f"/api/lessons/{job['lesson_id']}").json()
        assert clip.exists() and eco["video_url"] is None and eco["audio_url"]

        # a kept upload: its sound becomes the lesson's MP3, then the upload goes
        up = c.put("/api/uploads/b.mp4", content=clip.read_bytes()).json()
        jid = c.post("/api/jobs", json={"options": {"video": "original", "transcriber": "none", "audit": "none"}, "upload_id": up["upload_id"]}).json()["id"]
        end = time.time() + 60
        while (j := c.get(f"/api/jobs/{jid}").json())["status"] not in ("completed", "error") and time.time() < end:
            time.sleep(0.1)
        kept = c.get(f"/api/lessons/{j['lesson_id']}").json()
        folder = data_dir / "output" / kept["job_id"]
        assert (folder / "original.mp4").is_file()
        c.post(f"/api/lessons/{kept['id']}/drop-video")
        after = c.get(f"/api/lessons/{kept['id']}").json()
    assert not (folder / "original.mp4").exists() and (folder / Artifacts.AUDIO).is_file()
    assert after["audio_url"] and after["video_url"] is None and after["original_file"] == ""
