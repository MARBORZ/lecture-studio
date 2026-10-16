"""
Inputs the pipeline cannot process are refused before a job starts, with a reason a person can act on.
"""

import subprocess

import pytest
from fastapi.testclient import TestClient

from backend.core.media import ffmpeg_available
from backend.i18n import tr

pytestmark = pytest.mark.skipif(not ffmpeg_available(), reason="needs ffmpeg")


def make(path, *inputs):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-t", "2", str(path)], check=True)


def test_video_without_sound_is_refused(data_dir, tmp_path):
    from backend.main import app

    clip = tmp_path / "videoplayback.mp4"  # what a YouTube stream download looks like
    make(clip, "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10")
    with TestClient(app) as c:
        r = c.post("/api/jobs", json={"options": {"local_path": str(clip)}})
    assert r.status_code == 400
    assert r.json()["detail"] == tr("media.no_audio", hint=tr("media.youtube_hint"))


def test_broken_file_is_refused(data_dir, tmp_path):
    from backend.main import app

    junk = tmp_path / "lecture.mp4"
    junk.write_bytes(b"not a video at all" * 100)
    with TestClient(app) as c:
        r = c.post("/api/jobs", json={"options": {"local_path": str(junk)}})
    assert r.status_code == 400 and r.json()["detail"].startswith(tr("media.unreadable", error="|").split("|")[0])


def test_ffmpeg_failures_carry_the_reason_not_the_progress_log(tmp_path):
    from backend.core.media.base import run_ffmpeg

    clip = tmp_path / "v.mp4"
    make(clip, "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10")
    with pytest.raises(RuntimeError) as e:
        run_ffmpeg(["ffmpeg", "-y", "-i", str(clip), "-vn", "-acodec", "pcm_s16le", str(tmp_path / "a.wav")], "audio extraction")
    assert "does not contain any stream" in str(e.value) and "bitrate" not in str(e.value)


def test_audio_file_passes(data_dir, tmp_path):
    from backend.core.media import check_input

    audio = tmp_path / "talk.mp3"
    make(audio, "-f", "lavfi", "-i", "sine=frequency=440")
    assert check_input(audio) > 1.5
