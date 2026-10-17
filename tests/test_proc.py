"""spawn_script: the launcher scripts run detached, through zsh on macOS and wscript on Windows."""

import subprocess
import sys
from pathlib import Path


def test_spawn_script_picks_the_platform_script(monkeypatch, tmp_path):
    from backend.utils import proc

    calls = []
    monkeypatch.setattr(subprocess, "Popen", lambda cmd, **kw: calls.append((cmd, kw)))
    monkeypatch.setattr(sys, "platform", "darwin")
    proc.spawn_script(Path("/app/launcher/macos/start"), "update", cwd=tmp_path)
    cmd, kw = calls[-1]
    assert cmd == ["/bin/zsh", "/app/launcher/macos/start.zsh", "update"]
    assert kw["start_new_session"] and kw["cwd"] == tmp_path and kw["stdin"] is subprocess.DEVNULL
