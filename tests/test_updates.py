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
    from backend.services.updates import parse_version

    assert parse_version("v1.10.0") > parse_version("v1.9.3")
    assert parse_version("1.0.0") == (1, 0, 0)
    assert parse_version("v1.0") is None and parse_version("latest") is None


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
