"""The Videos tab: links, yt-dlp output parsing, errors for the user, the download job (progress, cancel) and its API."""

import io
import json
import threading
import time

import pytest
from fastapi.testclient import TestClient

from backend.services import videos
from backend.services.jobs import JobRegistry

VID = "dQw4w9WgXcQ"


@pytest.mark.parametrize(
    "url",
    [
        f"https://www.youtube.com/watch?v={VID}", f"https://youtu.be/{VID}?t=10", f"youtube.com/watch?v={VID}&list=PL1",
        f"https://m.youtube.com/watch?v={VID}", f"https://www.youtube.com/shorts/{VID}", f"https://www.youtube-nocookie.com/embed/{VID}",
        f"https://www.youtube.com/live/{VID}", VID,
    ],
)
def test_video_id_from_any_youtube_link(url):
    assert videos.video_id(url) == VID


@pytest.mark.parametrize("url", ["https://vimeo.com/123", "https://evil.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/@channel", "", "short"])
def test_not_youtube_videos(url):
    assert videos.video_id(url) is None


SEARCH = {
    "entries": [
        {"id": "B-QZEbnuT9g", "title": "Python Functions", "channel": "ZippyCode", "duration": 220, "view_count": 1665, "ie_key": "Youtube"},
        {"id": "UCabcdefghijklmnopqrstuv", "title": "A channel", "ie_key": "YoutubeTab"},
        {"id": "vg7Hwd9TANY", "title": "Python functions", "uploader": "Bro Code", "duration": None, "ie_key": "Youtube"},
    ]
}


def test_parse_search_keeps_videos_only():
    items = videos.parse_search(json.dumps(SEARCH))
    assert [(i.id, i.channel, i.duration) for i in items] == [("B-QZEbnuT9g", "ZippyCode", 220), ("vg7Hwd9TANY", "Bro Code", None)]
    assert items[0].thumbnail == "https://i.ytimg.com/vi/B-QZEbnuT9g/mqdefault.jpg"
    assert items[0].url == "https://www.youtube.com/watch?v=B-QZEbnuT9g"


def test_parse_info():
    raw = {
        "id": VID, "title": "T", "channel": "C", "duration": 61, "upload_date": "20240131",
        "license": "Creative Commons Attribution license (reuse allowed)", "description": "line1\nline2", "age_limit": 0, "is_live": False,
    }
    info = videos.parse_info(json.dumps(raw))
    assert (info.upload_date, info.license, info.description, info.duration) == ("2024-01-31", raw["license"], "line1\nline2", 61)


@pytest.mark.parametrize(
    ("stderr", "key"),
    [
        ("ERROR: [youtube] x: Sign in to confirm your age. This video may be inappropriate for some users.", "video.age"),
        ("ERROR: [youtube] x: Sign in to confirm you're not a bot", "video.bot"),
        ("ERROR: [youtube] x: Private video. Sign in if you've been granted access", "video.unavailable"),
        ("ERROR: [youtube] x: Video unavailable", "video.unavailable"),
        ("ERROR: [youtube] x: This live event will begin in 3 hours.", "video.live"),
        ("ERROR: Unable to download webpage: <urlopen error [Errno 8] nodename nor servname provided, or not known>", "video.offline"),
        ("ERROR: Unsupported URL: https://example.com", "video.bad_url"),
    ],
)
def test_errors_are_said_plainly(stderr, key):
    from backend.i18n import tr

    assert videos._explain(stderr) == tr(key)


def test_unknown_errors_keep_the_last_line():
    text = videos._explain("WARNING: x\nERROR: [youtube] abc: Something new broke")
    assert "Something new broke" in text and "ERROR:" not in text


def test_search_runs_ytdlp_in_a_child_process(monkeypatch):
    seen = []

    class Done:
        returncode, stdout, stderr = 0, json.dumps(SEARCH), ""

    monkeypatch.setattr(videos.subprocess, "run", lambda cmd, **kw: seen.append((cmd, kw)) or Done())
    assert len(videos.search("  python   functions ")) == 2
    cmd, kw = seen[0]
    assert cmd[1:3] == ["-m", "yt_dlp"] and "ytsearch20:python functions" in cmd and kw["encoding"] == "utf-8"
    assert videos.search("   ") == [] and len(seen) == 1  # an empty query asks nothing


# ---------------------------------------------------------------- the download job


class FakeProcess:
    """yt-dlp as a child process: prints progress lines, then the saved file; or hangs until terminated."""

    def __init__(self, lines, code=0, stderr="", hang=False):
        self.pid, self.code, self.killed = 4242, code, threading.Event()
        self.stderr = io.StringIO(stderr)
        self._lines, self._hang = lines, hang
        self.stdout = self._out()

    def _out(self):
        for line in self._lines:
            yield line + "\n"
        if self._hang:
            self.killed.wait(5)

    def wait(self):
        return -15 if self.killed.is_set() else self.code


def run_job(monkeypatch, folder, fake, cancel_after=None):
    job = JobRegistry.create("download", "t", ["download"])
    monkeypatch.setattr(videos, "paths", lambda: type("P", (), {"downloads": folder})())
    killed = []
    monkeypatch.setattr(videos.proc, "terminate_tree", lambda pid: (killed.append(pid), fake.killed.set()))
    monkeypatch.setattr(videos.subprocess, "Popen", lambda cmd, **kw: fake)
    worker = threading.Thread(target=videos._download, args=(job.id, VID, ""))
    worker.start()
    if cancel_after is not None:
        time.sleep(cancel_after)
        JobRegistry.request_cancel(job.id)
    worker.join(10)
    return JobRegistry.get(job.id), killed


def test_download_reports_progress_and_the_file(monkeypatch, tmp_path, data_dir):
    tmp_path = tmp_path / "downloads"
    tmp_path.mkdir()
    final = tmp_path / f"Lecture one [{VID}].mp4"
    final.write_bytes(b"mp4")
    seen = []
    real_update = JobRegistry.update
    monkeypatch.setattr(JobRegistry, "update", classmethod(lambda cls, jid, **f: (seen.append(f), real_update.__func__(cls, jid, **f))[1]))
    fake = FakeProcess([
        "[youtube] x", "LSPROGRESS  10.0% avc1.640028", "LSPROGRESS  60.0% avc1.640028", "LSPROGRESS 100.0% avc1.640028",
        "LSPROGRESS   5.0% none", "LSPROGRESS 100.0% none", f"LSFILE {final}",
    ])
    job, _ = run_job(monkeypatch, tmp_path, fake)
    assert job.status == "completed" and job.media_path == str(final) and job.title == "Lecture one"
    progress = [f["progress"] for f in seen if "progress" in f]
    assert progress == sorted(progress) and progress[-1] == 100  # video 0–80, sound 80–95, merge 99, done 100
    assert any("Звук" in f.get("message", "") for f in seen)


def test_download_error_is_plain(monkeypatch, tmp_path, data_dir):
    fake = FakeProcess(["[youtube] x"], code=1, stderr="ERROR: [youtube] x: Private video. Sign in if you've been granted access\n")
    job, _ = run_job(monkeypatch, tmp_path, fake)
    assert job.status == "error" and "недоступно" in job.error


def test_cancel_stops_ytdlp_and_cleans_up(monkeypatch, tmp_path, data_dir):
    tmp_path = tmp_path / "downloads"
    tmp_path.mkdir()
    (tmp_path / f"Talk [{VID}].f137.mp4.part").write_bytes(b"x")
    (tmp_path / f"Talk [{VID}].f140.m4a").write_bytes(b"x")
    keep = tmp_path / "Other [abcdefghijk].mp4"
    keep.write_bytes(b"x")
    fake = FakeProcess(["LSPROGRESS 12.0%"], hang=True)
    job, killed = run_job(monkeypatch, tmp_path, fake, cancel_after=0.5)
    assert job.status == "cancelled" and killed == [4242]
    assert sorted(p.name for p in tmp_path.iterdir()) == [keep.name]


def test_download_command():
    cmd = videos.download_cmd(VID, videos.Path("/tmp/d"))
    assert "--merge-output-format" in cmd and "mp4" in cmd and "height<=1080" in cmd[cmd.index("-f") + 1]
    assert cmd[-1] == f"https://www.youtube.com/watch?v={VID}" and "--no-playlist" in cmd
    assert "--progress" in cmd and "--newline" in cmd  # --print makes yt-dlp quiet: without --progress no progress lines


# ---------------------------------------------------------------- API


@pytest.fixture()
def client(data_dir):
    from backend.main import app

    with TestClient(app, base_url="http://127.0.0.1") as c:
        yield c


def test_download_needs_the_rights_notice_once(client, monkeypatch):
    started = []
    monkeypatch.setattr(videos, "_download", lambda *a: started.append(a))
    r = client.post("/api/videos/download", json={"url": f"https://youtu.be/{VID}"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "terms"
    assert client.get("/api/settings").json()["video_terms_accepted"] is False
    client.patch("/api/settings", json={"video_terms_accepted": True})
    job = client.post("/api/videos/download", json={"url": f"https://youtu.be/{VID}", "title": "Урок"}).json()
    assert (job["kind"], job["stages"], job["title"]) == ("download", ["download"], "Урок")
    for _ in range(50):
        if started:
            break
        time.sleep(0.02)
    assert started and started[0][1] == VID
    assert client.post("/api/videos/download", json={"url": "https://vimeo.com/1"}).status_code == 400


def test_search_api_errors_are_readable(client, monkeypatch):
    class Failed:
        returncode, stdout, stderr = 1, "", "ERROR: Unable to download webpage: [Errno 8] nodename nor servname provided"

    monkeypatch.setattr(videos.subprocess, "run", lambda cmd, **kw: Failed())
    r = client.get("/api/videos/search", params={"q": "python"})
    assert r.status_code == 502 and "YouTube" in r.json()["detail"]


def test_downloader_version(client, monkeypatch):
    class Version:
        returncode, stdout, stderr = 0, "2025.01.15\n", ""

    monkeypatch.setattr(videos.subprocess, "run", lambda cmd, **kw: Version())
    monkeypatch.setattr(videos, "_pypi_latest", lambda: "2026.8.19")
    assert client.get("/api/videos/downloader").json() == {"version": "2025.01.15", "latest": "2026.8.19", "update_available": True}
