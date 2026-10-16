"""
Settings → AI → "Connect Claude": put this app's MCP server (mcp_server.py, the lesson library tools) into the user's
own Claude apps, so their Claude reads lessons and writes audits on their subscription. The app never calls Claude
itself: it only writes the client's config, the way the user would by hand (docs/MCP_SETUP.md).

  Claude Desktop  its JSON config (mcpServers.lecture-studio); merged, the rest of the file is kept, a .bak first
  Claude Code     `claude mcp add --scope user lecture-studio -- <command>`; status read from ~/.claude.json

Paths can be overridden for tests (LECTURE_STUDIO_CLAUDE_DESKTOP_CONFIG, LECTURE_STUDIO_CLAUDE_CODE_CONFIG,
LECTURE_STUDIO_CLAUDE_BIN) — nothing here should touch a developer's real Claude setup in a test.
"""

import logging
import os
import shutil
import subprocess
import sys
from pathlib import Path

from backend import config
from backend.i18n import tr
from backend.models.system import McpClient, McpStatus
from backend.utils.fs import read_json, write_json

logger = logging.getLogger(__name__)

NAME = "lecture-studio"
CLI_TIMEOUT = 60


class McpError(RuntimeError):
    """For the user, already translated."""


def desktop_config() -> Path:
    if env := os.getenv("LECTURE_STUDIO_CLAUDE_DESKTOP_CONFIG"):
        return Path(env)
    if sys.platform == "darwin":
        return Path.home() / "Library/Application Support/Claude/claude_desktop_config.json"
    if sys.platform == "win32":
        return Path(os.getenv("APPDATA", str(Path.home()))) / "Claude" / "claude_desktop_config.json"
    return Path.home() / ".config/Claude/claude_desktop_config.json"


def code_config() -> Path:
    return Path(os.getenv("LECTURE_STUDIO_CLAUDE_CODE_CONFIG") or Path.home() / ".claude.json")


def claude_bin() -> str | None:
    return os.getenv("LECTURE_STUDIO_CLAUDE_BIN") or shutil.which("claude") or _known_claude()


def _known_claude() -> str | None:
    # the app is started from a shortcut: its PATH may lack the usual install places
    for p in (Path.home() / ".local/bin/claude", Path("/opt/homebrew/bin/claude"), Path("/usr/local/bin/claude")):
        if p.is_file():
            return str(p)
    return None


def server_entry() -> dict:
    """How a client starts the MCP server: the full path to uv (a GUI app does not inherit the shell's PATH)."""
    uv = shutil.which("uv") or str(Path.home() / ".local/bin/uv")
    return {"command": uv, "args": ["run", "--quiet", "--directory", str(config.REPO_DIR), "python", "mcp_server.py"]}


def status() -> McpStatus:
    desktop_file = desktop_config()
    desktop = read_json(desktop_file, {}) if desktop_file.is_file() else {}
    code = read_json(code_config(), {}) if code_config().is_file() else {}
    return McpStatus(
        desktop=McpClient(
            available=desktop_file.parent.is_dir(),
            connected=NAME in (desktop.get("mcpServers") or {}),
            where=str(desktop_file),
        ),
        code=McpClient(
            available=claude_bin() is not None,
            connected=NAME in (code.get("mcpServers") or {}),
            where=str(code_config()),
        ),
    )


def connect_desktop() -> McpStatus:
    path = desktop_config()
    if not path.parent.is_dir():
        raise McpError(tr("mcp.no_desktop"))
    data = read_json(path, {}) if path.is_file() else {}
    if not isinstance(data, dict):
        raise McpError(tr("mcp.bad_config", path=path))
    if path.is_file():
        shutil.copy2(path, path.with_suffix(".json.bak"))  # the user's file as it was, once per change
    data.setdefault("mcpServers", {})[NAME] = server_entry()
    write_json(path, data)
    return status()


def disconnect_desktop() -> McpStatus:
    path = desktop_config()
    data = read_json(path, {}) if path.is_file() else {}
    if isinstance(data, dict) and NAME in (data.get("mcpServers") or {}):
        shutil.copy2(path, path.with_suffix(".json.bak"))
        del data["mcpServers"][NAME]
        write_json(path, data)
    return status()


def _cli(*args: str) -> None:
    exe = claude_bin()
    if not exe:
        raise McpError(tr("mcp.no_code"))
    try:
        r = subprocess.run([exe, "mcp", *args], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=CLI_TIMEOUT)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise McpError(tr("mcp.cli_failed", error=str(e)[:200])) from e
    if r.returncode != 0:
        raise McpError(tr("mcp.cli_failed", error=(r.stderr or r.stdout).strip()[:300]))


def connect_code() -> McpStatus:
    entry = server_entry()
    if status().code.connected:
        _cli("remove", "--scope", "user", NAME)  # replace: the app folder or uv may have moved
    _cli("add", "--scope", "user", NAME, "--", entry["command"], *entry["args"])
    return status()


def disconnect_code() -> McpStatus:
    if status().code.connected:
        _cli("remove", "--scope", "user", NAME)
    return status()
