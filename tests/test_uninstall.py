"""
Delete Lecture Studio from the app: the plan (what goes, what stays, when it refuses) and the macOS uninstaller run for real
in a sandbox. The server is never actually stopped here: _stop_everything and the spawn are replaced.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


def git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


@pytest.fixture()
def installed(tmp_path, data_dir, monkeypatch):
    """A clone of origin as the app folder, a separate settings home, lessons in data_dir (outside both)."""
    origin, app, home = tmp_path / "origin.git", tmp_path / "app", data_dir.parent / "home"
    git(tmp_path, "init", "-q", "--bare", "-b", "main", str(origin))
    git(tmp_path, "clone", "-q", str(origin), str(app))
    git(app, "config", "user.email", "t@t")
    git(app, "config", "user.name", "t")
    (app / "README.md").write_text("app")
    git(app, "add", "README.md")
    git(app, "commit", "-qm", "Initial")
    git(app, "push", "-q", "origin", "main")

    import backend.api.routes.system as system
    import backend.config as config
    from backend.services import uninstall

    monkeypatch.setattr(config, "REPO_DIR", app)
    monkeypatch.setattr(config, "APP_HOME", home)
    spawned = []
    monkeypatch.setattr(uninstall, "_spawn", lambda work, plan_file: spawned.append(plan_file.read_text("utf-8")))
    monkeypatch.setattr(system, "_stop_everything", lambda: None)
    return app, home, spawned


def client():
    from backend.api.app import create_app

    return TestClient(create_app())


def plan_lines(text: str, key: str) -> list[str]:
    return [line.split("\t", 1)[1] for line in text.splitlines() if line.startswith(key + "\t")]


def test_preview_of_a_clean_install(installed, data_dir):
    app, home, _ = installed
    with client() as c:
        plan = c.get("/api/system/uninstall").json()
    assert plan["app_dir"] == str(app.resolve()) and plan["settings_dir"] == str(home.resolve())
    assert plan["data_dir"] == str(data_dir.resolve()) and not plan["lessons_inside"]
    assert plan["blocked"] is None and plan["reinstall"] == "git" and plan["repo_url"].startswith("https://github.com/")


def test_lessons_stay_by_default(installed, data_dir):
    app, home, spawned = installed
    with client() as c:
        r = c.post("/api/system/uninstall", json={})
    assert r.status_code == 200, r.text
    assert r.json()["kept"] == str(data_dir.resolve())
    remove = plan_lines(spawned[0], "remove")
    assert remove == [str(app.resolve()), str(home.resolve())]  # nothing from the library
    assert plan_lines(spawned[0], "remove_if_empty") == []
    assert str(data_dir.resolve()) in plan_lines(spawned[0], "message")[0]


def test_lessons_go_only_when_asked_and_only_library_items(installed, data_dir):
    _, _, spawned = installed
    (data_dir / "my-own-notes.txt").write_text("not ours")  # data_dir may be a folder like ~/Documents
    with client() as c:
        r = c.post("/api/system/uninstall", json={"delete_lessons": True})
    assert r.status_code == 200 and r.json()["kept"] is None
    remove = plan_lines(spawned[0], "remove")
    assert str((data_dir / "output").resolve()) in remove and str(data_dir.resolve()) not in remove
    assert plan_lines(spawned[0], "remove_if_empty") == [str(data_dir.resolve())]  # the folder goes only if empty


def test_git_work_blocks_deleting_a_developer_checkout(installed):
    app, _, spawned = installed
    (app / "README.md").write_text("edited")
    git(app, "commit", "-qam", "Local only")
    (app / "new.py").write_text("x = 1")
    with client() as c:
        plan = c.get("/api/system/uninstall").json()
        r = c.post("/api/system/uninstall", json={"delete_lessons": True})
    assert plan["blocked"] == "git_work"
    assert "new.py" in plan["git_files"] and any(f.startswith("commit ") and "Local only" in f for f in plan["git_files"])
    assert r.status_code == 409 and r.json()["detail"]["code"] == "git_work" and spawned == []


def test_lessons_inside_the_app_must_be_moved_or_deleted(installed, monkeypatch):
    app, _, spawned = installed
    from backend.settings.service import Paths, SettingsService

    monkeypatch.setattr(SettingsService, "paths", classmethod(lambda cls: Paths(app / "workspace")))
    with client() as c:
        assert c.get("/api/system/uninstall").json()["lessons_inside"]
        r = c.post("/api/system/uninstall", json={})
        assert r.status_code == 409 and r.json()["detail"]["code"] == "lessons_inside" and spawned == []
        assert c.post("/api/system/uninstall", json={"delete_lessons": True}).status_code == 200


def test_never_deletes_the_home_folder(installed, monkeypatch):
    from backend.services import uninstall
    from backend.settings.service import Paths, SettingsService

    monkeypatch.setattr(SettingsService, "paths", classmethod(lambda cls: Paths(Path.home())))
    with pytest.raises(uninstall.UninstallError) as e:
        uninstall.start(delete_lessons=True)
    assert e.value.code == "unsafe"


def test_busy_refuses_uninstall(installed, monkeypatch):
    _, _, spawned = installed
    from backend.models.system import BusyReason
    from backend.services.jobs import JobRegistry

    monkeypatch.setattr(JobRegistry, "busy_reasons", classmethod(lambda cls: [BusyReason(kind="job", label="Урок 1", progress=40)]))
    with client() as c:
        r = c.post("/api/system/uninstall", json={})
    assert r.status_code == 409 and r.json()["detail"]["reasons"][0]["label"] == "Урок 1" and spawned == []


@pytest.mark.skipif(sys.platform != "darwin" or not shutil.which("zsh"), reason="macOS uninstaller")
def test_macos_uninstaller_deletes_the_plan_and_nothing_else(tmp_path):
    script = Path(__file__).resolve().parent.parent / "launcher" / "macos" / "remove.zsh"
    home = tmp_path / "home"
    app, settings, data = home / "dev" / "app", home / "Library" / "Lecture Studio", home / "Lessons"
    for d in (app / ".venv", settings / "logs", data / "output", home / "Desktop"):
        d.mkdir(parents=True)
    (data / "notes.txt").write_text("not ours")
    ours = home / "Desktop" / "Lecture Studio.app" / "Contents"
    ours.mkdir(parents=True)
    (ours / "Info.plist").write_text("<key>CFBundleIdentifier</key><string>local.lecture-studio.launcher</string>")
    other = home / "Desktop" / "Other.app"
    other.mkdir()

    dead = subprocess.Popen(["true"])
    dead.wait()
    work = tmp_path / "work"
    work.mkdir()
    plan = work / "plan.tsv"
    lines = [f"pid\t{dead.pid}", "ui_port\t1", f"profile\t{tmp_path}/no-such-profile", "message\tdone", "failed\tleft:"]
    lines += [f"remove\t{p}" for p in (app, settings, data / "output", home)]  # home: refused by the script
    lines += [f"remove_if_empty\t{data}"]
    plan.write_text("\n".join(lines) + "\n")
    env = {**os.environ, "HOME": str(home), "LS_UNINSTALL_QUIET": "1"}
    subprocess.run(["/bin/zsh", str(script), str(plan)], env=env, check=True, timeout=60)

    assert not app.exists() and not settings.exists() and not (data / "output").exists()
    assert (data / "notes.txt").exists()  # data_dir is not empty: kept
    assert not (home / "Desktop" / "Lecture Studio.app").exists() and other.exists()
    assert home.exists() and not work.exists()  # the home folder in the plan is refused; the plan cleans itself up


# ---------------------------------------------------------------- Uninstall.app / Uninstall.cmd (backend.tools.uninstall)


@pytest.fixture()
def tool(installed, monkeypatch):
    """The CLI with no real network: _api answers as the test says (never the app running on this machine)."""
    from backend.tools import uninstall as cli

    calls = []
    state = {"running": None, "post": (200, {"ok": True})}

    def fake_api(method, path, body=None, timeout=5):
        calls.append((method, path, body))
        if method == "GET":
            if state["running"] is None:
                raise OSError("connection refused")
            return 200, {"app_dir": state["running"]}
        return state["post"]

    monkeypatch.setattr(cli, "_api", fake_api)
    return cli, state, calls


def test_tool_describe_says_what_goes_and_where_lessons_stay(installed, tool, data_dir, capsys):
    app, home, _ = installed
    cli, _, _ = tool
    assert cli.main(["describe"]) == 0
    out = capsys.readouterr().out.splitlines()
    assert out[0] == "ok"
    text = "\n".join(out[1:])
    assert str(app.resolve()) in text and str(home.resolve()) in text and str(data_dir.resolve()) in text


def test_tool_describe_blocked_on_git_work(installed, tool, capsys):
    app, _, _ = installed
    cli, _, _ = tool
    (app / "new.py").write_text("x = 1")
    cli.main(["describe"])
    out = capsys.readouterr().out.splitlines()
    assert out[0] == "blocked" and "new.py" in out


def test_tool_runs_directly_when_nothing_is_running(installed, tool):
    _, _, spawned = installed
    cli, _, calls = tool
    assert cli.main(["run", "--delete-lessons"]) == 0
    assert len(spawned) == 1 and "remove_if_empty" in spawned[0]
    assert [c[0] for c in calls] == ["GET"]  # asked who is running, posted nothing


def test_tool_goes_through_the_api_of_this_install(installed, tool):
    app, _, spawned = installed
    cli, state, calls = tool
    state["running"] = str(app.resolve())
    assert cli.main(["run"]) == 0
    assert calls[-1] == ("POST", "/api/system/uninstall", {"delete_lessons": False}) and spawned == []


def test_tool_reports_busy_from_the_api(installed, tool, capsys):
    app, _, _ = installed
    cli, state, _ = tool
    state["running"] = str(app.resolve())
    state["post"] = (409, {"detail": {"message": "Система занята", "reasons": [{"kind": "job", "label": "Урок 1"}]}})
    assert cli.main(["run"]) == 2
    assert "Урок 1" in capsys.readouterr().err


def test_tool_never_touches_another_running_copy(installed, tool, capsys):
    _, _, spawned = installed
    cli, state, calls = tool
    state["running"] = "/Users/someone/Downloads/lecture-studio"
    assert cli.main(["run", "--delete-lessons"]) == 2
    assert "/Users/someone/Downloads/lecture-studio" in capsys.readouterr().err
    assert spawned == [] and all(c[0] == "GET" for c in calls)


def test_preview_points_to_the_setup_and_uninstall_of_this_os(installed, monkeypatch):
    app, _, _ = installed
    from backend.services import uninstall

    root = app.resolve()
    monkeypatch.setattr(uninstall.sys, "platform", "darwin")
    plan = uninstall.preview()
    assert plan.uninstaller == str(root / "setups" / "macos" / "Uninstall.app") and plan.setup == str(root / "setups" / "macos" / "Setup.app")
    assert str(root / "setups" / "macos" / "Setup.app") in uninstall._message(plan, delete_lessons=False)  # the way back
    monkeypatch.setattr(uninstall.sys, "platform", "win32")
    assert uninstall.preview().uninstaller == str(root / "setups" / "windows" / "Uninstall.cmd")
    monkeypatch.setattr(uninstall.sys, "platform", "linux")
    assert uninstall.preview().uninstaller == ""


def test_the_native_setups_are_where_the_plan_says():
    from pathlib import Path

    from backend.services.uninstall import _NATIVE

    root = Path(__file__).resolve().parent.parent
    assert all((root / p).exists() for pair in _NATIVE.values() for p in pair)
