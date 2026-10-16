"""
The Node.js check of the macOS installer and launcher, run for real against a fake `node`, and its agreement with
frontend/package.json engines (the range Vite 8 accepts). The Windows twin (common.ps1: Test-NodeVersion) states the same range.
"""

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
RANGE = "^20.19.0 || >=22.12.0"
SCRIPTS = [ROOT / "setups" / "macos" / "install.zsh", ROOT / "launcher" / "macos" / "start.zsh"]


def node_ok_source(script: Path) -> str:
    m = re.search(r"^node_ok\(\) \{\n.*?^\}\n", script.read_text("utf-8"), re.S | re.M)
    assert m, f"node_ok not found in {script}"
    return m.group(0)


def test_engines_and_scripts_state_the_same_range():
    assert json.loads((ROOT / "frontend" / "package.json").read_text("utf-8"))["engines"]["node"] == RANGE
    for script in [*SCRIPTS, ROOT / "launcher" / "windows" / "common.ps1"]:
        assert RANGE in script.read_text("utf-8-sig"), script
    assert node_ok_source(SCRIPTS[0]) == node_ok_source(SCRIPTS[1])


@pytest.mark.skipif(sys.platform == "win32" or not shutil.which("zsh"), reason="zsh scripts")
@pytest.mark.parametrize(
    ("version", "ok"),
    [("v20.20.2", True), ("v20.19.0", True), ("v20.18.3", False), ("v21.7.0", False), ("v22.11.0", False),
     ("v22.12.0", True), ("v24.18.0", True), ("v18.20.0", False), ("", False)],
)
def test_macos_node_ok(tmp_path, version, ok):
    fake = tmp_path / "node"
    fake.write_text(f"#!/bin/sh\necho '{version}'\n" if version else "#!/bin/sh\nexit 127\n")
    fake.chmod(0o755)
    script = node_ok_source(SCRIPTS[0]) + "node_ok"
    res = subprocess.run(["/bin/zsh", "-fuc", script], env={"PATH": f"{tmp_path}:/usr/bin:/bin"}, capture_output=True, text=True)
    assert (res.returncode == 0) == ok, res.stderr
