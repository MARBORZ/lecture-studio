"""
Self-update against real temporary git repositories: origin (bare) with release tags, a clone that runs the app.
"""

import json
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient


def git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


def commit(repo, name, message):
    (repo / name).write_text(message)
    git(repo, "add", name)
    git(repo, "commit", "-qm", message)


@pytest.fixture()
def release_repos(tmp_path, data_dir, monkeypatch):
    """origin has v1.0.0 and v1.1.0; the clone runs 1.0.0 at v1.0.0."""
    origin, work, clone = tmp_path / "origin.git", tmp_path / "work", tmp_path / "clone"
    git(tmp_path, "init", "-q", "--bare", "-b", "main", str(origin))
    git(tmp_path, "clone", "-q", str(origin), str(work))
    for repo in (work,):
        git(repo, "config", "user.email", "t@t")
        git(repo, "config", "user.name", "t")
    commit(work, "a.txt", "Initial")
    git(work, "tag", "v1.0.0")
    git(work, "push", "-q", "origin", "main", "v1.0.0")
    git(tmp_path, "clone", "-q", "--branch", "main", str(origin), str(clone))
    git(clone, "config", "user.email", "t@t")
    git(clone, "config", "user.name", "t")
    commit(work, "b.txt", "Floating player")
    commit(work, "c.txt", "Chat attachments")
    git(work, "tag", "-a", "v1.1.0", "-m", "Lecture Studio 1.1.0\n\n- Floating video player\n- Attachments in chat")
    commit(work, "d.txt", "Unreleased work on main")
    git(work, "push", "-q", "origin", "main", "v1.1.0")

    import backend.config as config
    from backend.services import updates

    monkeypatch.setattr(config, "REPO_DIR", clone)
    monkeypatch.setattr(config, "APP_VERSION", "1.0.0")
    monkeypatch.setattr(config, "STATE_DIR", data_dir.parent / "home" / "state")
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setattr(updates, "_cache", None)
    monkeypatch.setattr(updates, "_last", None)
    spawned = []
    monkeypatch.setattr(updates, "spawn_launcher", lambda: spawned.append(True))
    monkeypatch.setattr(updates.threading, "Timer", lambda _delay, fn: type("T", (), {"start": lambda self: fn()})())
    return clone, work, spawned


def client():
    from backend.api.app import create_app

    return TestClient(create_app())


def test_version_parsing():
    from backend.services.updates import is_prerelease, parse_version

    assert parse_version("v1.10.0") > parse_version("v1.9.3")
    assert parse_version("1.0.0")[:3] == (1, 0, 0)
    assert parse_version("v1.0") is None and parse_version("latest") is None and parse_version("alpha-1.3.2") is None
    order = ["v0.9.9", "v1.0.0-alpha.1", "v1.0.0-beta.1", "v1.0.0-beta.2", "v1.0.0-beta.10", "v1.0.0-rc.1", "v1.0.0", "v1.0.1-beta.1", "v1.0.1"]
    assert sorted(reversed(order), key=parse_version) == order
    assert is_prerelease("v1.0.0-beta.3") and not is_prerelease("v1.0.0") and not is_prerelease("junk")


def test_pyproject_prerelease_is_named_like_its_tag():
    from backend.config import release_name

    assert release_name("1.0.0b1") == "1.0.0-beta.1" and release_name("2.1.0rc3") == "2.1.0-rc.3" and release_name("1.0.0a2") == "1.0.0-alpha.2"
    assert release_name("1.3.2") == "1.3.2"


def push_tags(work, *tags):
    for tag in tags:
        commit(work, f"{tag}.txt", tag)
        git(work, "tag", "-a", tag, "-m", f"Lecture Studio {tag}\n\n- {tag}")
    git(work, "push", "-q", "origin", "main", *tags)


def test_betas_only_for_beta_users_or_on_request(release_repos):
    _, work, _ = release_repos
    git(work, "tag", "alpha-9.9.9", "HEAD")  # the old releases, renamed: never offered
    push_tags(work, "v1.2.0-beta.1", "v1.2.0-beta.2")
    git(work, "push", "-q", "origin", "alpha-9.9.9")
    from backend.settings import SettingsService
    from backend.settings.schema import SettingsPatch

    with client() as c:
        info = c.get("/api/system/update?force=true").json()
        assert info["latest"] == "1.1.0" and not info["current_prerelease"]  # a release runs: releases only
        SettingsService.patch(SettingsPatch(beta_updates=True))
        info = c.get("/api/system/update?force=true").json()
        assert info["latest"] == "1.2.0-beta.2" and info["changes"] == ["v1.2.0-beta.2"]


def test_a_beta_gets_the_next_beta_then_the_release(release_repos, monkeypatch):
    clone, work, _ = release_repos
    import backend.config as config

    push_tags(work, "v1.2.0-beta.1", "v1.2.0-beta.2")
    git(clone, "fetch", "-q", "--tags", "origin")
    git(clone, "merge", "-q", "--ff-only", "v1.2.0-beta.1")
    monkeypatch.setattr(config, "APP_VERSION", "1.2.0-beta.1")
    with client() as c:
        info = c.get("/api/system/update?force=true").json()
        assert info["current_prerelease"] and info["current_released_at"]
        assert info["latest"] == "1.2.0-beta.2" and info["blocked"] is None
        assert c.post("/api/system/update").status_code == 200
    assert (clone / "v1.2.0-beta.2.txt").exists()

    monkeypatch.setattr(config, "APP_VERSION", "1.2.0-beta.2")
    push_tags(work, "v1.2.0")
    with client() as c:
        assert c.get("/api/system/update?force=true").json()["latest"] == "1.2.0"


def test_zip_install_sees_prereleases_too(release_repos, monkeypatch):
    import backend.config as config
    from backend.services import updates

    releases = [
        {"tag_name": "v1.0.0-beta.2", "html_url": "https://x/b2", "published_at": "2026-10-20T10:00:00Z", "body": "- Beta two"},
        {"tag_name": "alpha-1.3.2", "html_url": "https://x/old"},
    ]
    monkeypatch.setattr(updates, "_github_releases", lambda: releases)
    monkeypatch.setattr(config, "APP_VERSION", "1.0.0-beta.1")
    info = updates._check_zip()
    assert info.available and info.latest == "1.0.0-beta.2" and info.url == "https://x/b2" and info.changes == ["Beta two"]
    monkeypatch.setattr(config, "APP_VERSION", "0.9.0")
    assert not updates._check_zip().available  # a release runs and betas were not asked for


def test_check_finds_the_newest_release_not_main(release_repos):
    with client() as c:
        info = c.get("/api/system/update?force=true").json()
    assert info["available"] and info["latest"] == "1.1.0" and info["blocked"] is None
    assert info["changes"] == ["Floating video player", "Attachments in chat"]  # notes of the annotated tag
    assert info["url"].endswith("/releases/tag/v1.1.0")


def test_apply_fast_forwards_and_hands_over(release_repos, data_dir, monkeypatch):
    clone, _, spawned = release_repos
    import backend.config as config

    with client() as c:
        r = c.post("/api/system/update")
    assert r.status_code == 200, r.text
    assert (clone / "c.txt").exists() and not (clone / "d.txt").exists()
    handover = json.loads((config.STATE_DIR / "update.json").read_text())
    assert handover["to_version"] == "1.1.0" and handover["from_version"] == "1.0.0" and len(handover["from_sha"]) == 40
    assert spawned == [True]

    # restart: the new version reports success once
    from backend.services import updates

    config.APP_VERSION = "1.1.0"
    updates.consume_outcome()
    first = updates.check(force=False)
    assert first.last and first.last.ok and first.last.to_version == "1.1.0"
    assert updates.check().last == first.last  # repeated: the UI dedupes by `at`
    monkeypatch.setattr(updates.time, "time", lambda: first.last.at + updates.OUTCOME_SEC + 1)
    assert updates.check().last is None


def test_rollback_is_reported(release_repos):
    import backend.config as config
    from backend.services import updates

    config.STATE_DIR.mkdir(parents=True, exist_ok=True)
    (config.STATE_DIR / "update.json").write_text(json.dumps({"from_sha": "0" * 40, "from_version": "1.0.0", "to_version": "1.1.0"}))
    updates.consume_outcome()  # still 1.0.0 running: the launcher rolled back
    out = updates.check().last
    assert out and not out.ok


def test_dirty_tree_and_local_commits_block_apply(release_repos):
    clone, _, spawned = release_repos
    (clone / "a.txt").write_text("edited by hand")
    with client() as c:
        assert c.get("/api/system/update?force=true").json()["blocked"] == "dirty"
        r = c.post("/api/system/update")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "dirty"

    git(clone, "checkout", "-q", "a.txt")
    commit(clone, "local.txt", "Local change")
    with client() as c:
        assert c.get("/api/system/update?force=true").json()["blocked"] == "diverged"
    assert spawned == []


def test_busy_refuses_update(release_repos, monkeypatch):
    from backend.models.system import BusyReason
    from backend.services.jobs import JobRegistry

    monkeypatch.setattr(JobRegistry, "busy_reasons", classmethod(lambda cls: [BusyReason(kind="job", label="Урок 1", progress=40)]))
    with client() as c:
        r = c.post("/api/system/update")
    assert r.status_code == 409 and r.json()["detail"]["reasons"][0]["label"] == "Урок 1"


def test_offline_check_reports_error(release_repos, tmp_path):
    clone, _, _ = release_repos
    git(clone, "remote", "set-url", "origin", str(tmp_path / "missing.git"))
    with client() as c:
        info = c.get("/api/system/update?force=true").json()
    assert not info["available"] and info["error"]


def test_lightweight_tag_lists_commits_of_the_release_only(release_repos, tmp_path):
    clone, work, _ = release_repos
    git(work, "tag", "-d", "v1.1.0")
    git(work, "tag", "v1.1.0", "HEAD~1")
    git(work, "push", "-q", "--force", "origin", "v1.1.0")
    with client() as c:
        info = c.get("/api/system/update?force=true").json()
    assert info["changes"] == ["Chat attachments", "Floating player"]  # tag range only, not unreleased main


def test_windows_spawn_goes_through_wscript_like_the_shortcut(release_repos, monkeypatch):
    clone, _, _ = release_repos
    from backend.services import updates

    calls = []
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setenv("WINDIR", r"C:\Windows")
    monkeypatch.setattr(subprocess, "DETACHED_PROCESS", 8, raising=False)
    monkeypatch.setattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 512, raising=False)
    monkeypatch.setattr(subprocess, "Popen", lambda cmd, **kw: calls.append((cmd, kw)))
    import importlib

    real = importlib.reload(updates)  # the fixture replaced spawn_launcher: load the real one again
    monkeypatch.setattr(real.config, "REPO_DIR", clone)
    real.spawn_launcher()
    cmd, kw = calls[0]
    assert cmd[0].lower().endswith("wscript.exe") and "System32" in cmd[0]
    assert cmd[1:] == [str(clone / "launcher" / "windows" / "start.vbs"), "update"]
    assert kw["creationflags"] == 8 | 512 and kw["cwd"] == clone


def test_macos_spawn_is_unchanged(release_repos, monkeypatch):
    clone, _, _ = release_repos
    import importlib

    from backend.services import updates

    calls = []
    monkeypatch.setattr(subprocess, "Popen", lambda cmd, **kw: calls.append((cmd, kw)))
    real = importlib.reload(updates)
    monkeypatch.setattr(real.config, "REPO_DIR", clone)
    real.spawn_launcher()
    assert calls[0][0] == ["/bin/zsh", str(clone / "launcher" / "macos" / "start.zsh"), "update"]


def test_restart_failed_when_launcher_log_is_untouched(release_repos, data_dir, monkeypatch):
    import importlib
    import os

    import backend.config as config
    from backend.services import updates

    real = importlib.reload(updates)
    monkeypatch.setattr(config, "LOGS_DIR", data_dir.parent / "home" / "logs")
    config.LOGS_DIR.mkdir(parents=True, exist_ok=True)
    log = config.LOGS_DIR / "launcher.log"

    # no log at all, or an old one: the launcher did not start
    real._verify_launcher(since=time_now())
    assert real._restart_failed
    real._restart_failed = False
    log.write_text("=== launch (normal)")
    os.utime(log, (1, 1))
    real._verify_launcher(since=time_now())
    assert real._restart_failed
    assert real.check().restart_failed

    # the launcher wrote after the spawn: it is working, nothing to report
    real._restart_failed = False
    log.write_text("=== launch (update)")
    real._verify_launcher(since=time_now() - 5)
    assert not real._restart_failed and not real.check().restart_failed


def test_apply_watches_the_launcher(release_repos, monkeypatch):
    from backend.services import updates

    timers = []
    monkeypatch.setattr(updates.threading, "Timer", lambda delay, fn: timers.append((delay, fn)) or type("T", (), {"start": lambda self: None})())
    with client() as c:
        assert c.post("/api/system/update").status_code == 200
    assert [d for d, _ in timers] == [0.8]  # the verification is scheduled once the launcher has been spawned
    monkeypatch.setattr(updates, "_verify_launcher", lambda since: timers.append(("verify", since)))
    timers[0][1]()
    assert [d for d, _ in timers] == [0.8, updates.LAUNCHER_WAIT_SEC]


def test_dubious_ownership_gets_a_ready_command(release_repos, monkeypatch):
    clone, _, _ = release_repos
    from backend.services import updates

    real_run = subprocess.run

    def refusing(cmd, **kw):
        if cmd[:2] == ["git", "fetch"]:
            return subprocess.CompletedProcess(cmd, 128, "", "fatal: detected dubious ownership in repository at 'C:/x'")
        return real_run(cmd, **kw)

    monkeypatch.setattr(updates.subprocess, "run", refusing)
    with client() as c:
        info = c.get("/api/system/update?force=true").json()
    assert not info["available"]
    assert f'git config --global --add safe.directory "{clone.as_posix()}"' in info["error"]


def test_dirty_block_lists_changed_files(release_repos):
    clone, _, _ = release_repos
    (clone / "a.txt").write_text("edited by hand")
    with client() as c:
        info = c.get("/api/system/update?force=true").json()
    assert info["blocked"] == "dirty" and info["dirty_files"] == ["a.txt"]


def test_discard_puts_back_only_the_files_that_block(release_repos):
    clone, _, spawned = release_repos
    (clone / "a.txt").write_text("Initial\r\n")  # line endings alone: the case that stuck a Windows tester
    (clone / "staged new.txt").write_text("mine")
    git(clone, "add", "staged new.txt")
    (clone / "notes.txt").write_text("untracked, not ours to touch")
    with client() as c:
        assert c.get("/api/system/update?force=true").json()["dirty_files"] == ["a.txt", "staged new.txt"]
        r = c.post("/api/system/update/discard")
        assert r.status_code == 200, r.text
        info = r.json()
        assert info["available"] and info["blocked"] is None and info["dirty_files"] == []
        assert c.post("/api/system/update").status_code == 200
    assert (clone / "a.txt").read_text() == "Initial" and (clone / "staged new.txt").read_text() == "mine"
    assert (clone / "notes.txt").exists() and spawned == [True]


def time_now() -> float:
    import time

    return time.time()


def test_release_notes_stay_utf8_under_a_windows_locale(release_repos, monkeypatch):
    # Windows decodes text=True output as cp1252 unless told otherwise: "–" became "â€“" in the update dialog
    _, work, _ = release_repos
    commit(work, "e.txt", "Theme")
    git(work, "tag", "-a", "v1.2.0", "-m", "Lecture Studio 1.2.0\n\n- Reading text size (80–150%)\n- Тёмная тема")
    git(work, "push", "-q", "origin", "main", "v1.2.0")
    monkeypatch.setattr(subprocess, "_text_encoding", lambda: "cp1252")
    with client() as c:
        info = c.get("/api/system/update?force=true").json()
    assert info["latest"] == "1.2.0" and info["changes"] == ["Reading text size (80–150%)", "Тёмная тема"]


def test_release_dates_are_reported_but_the_number_decides(release_repos):
    _, work, _ = release_repos
    with client() as c:
        info = c.get("/api/system/update?force=true").json()
    assert info["released_at"] and info["current_released_at"]  # annotated v1.1.0, lightweight v1.0.0
    assert info["released_at"] >= info["current_released_at"]

    # a higher number with an older date (backdated tag) is still the newer release
    import os

    commit(work, "f.txt", "Hotfix")
    env = {**os.environ, "GIT_COMMITTER_DATE": "2020-01-01T12:00:00+00:00"}
    subprocess.run(["git", "tag", "-a", "v1.1.1", "-m", "Lecture Studio 1.1.1\n\n- Hotfix"], cwd=work, env=env, check=True, capture_output=True)
    git(work, "push", "-q", "origin", "main", "v1.1.1")
    with client() as c:
        info = c.get("/api/system/update?force=true").json()
    assert info["latest"] == "1.1.1" and info["released_at"].startswith("2020-01-01")


def test_forced_check_on_reload_asks_origin_but_not_in_a_storm(monkeypatch):
    # a page reload forces a real check; a burst of reloads reuses an answer fresher than FORCE_FLOOR_SEC
    from backend.services import updates

    calls = []
    now = [1000.0]
    monkeypatch.setattr(updates, "_cache", None)
    monkeypatch.setattr(updates, "is_git_install", lambda: True)
    monkeypatch.setattr(updates, "_check_git", lambda: calls.append(1) or updates._info("git"))
    monkeypatch.setattr(updates.time, "time", lambda: now[0])

    updates.check()
    updates.check(reload=True)  # reloaded right away: cached
    assert len(calls) == 1
    now[0] += updates.FORCE_FLOOR_SEC + 1
    updates.check()  # the periodic check keeps the long cache
    assert len(calls) == 1
    updates.check(reload=True)  # a reload later on: asks origin
    assert len(calls) == 2
