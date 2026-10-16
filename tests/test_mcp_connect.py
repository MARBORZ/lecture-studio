"""Connect Claude: our MCP server written into Claude Desktop's config, and added to Claude Code through its CLI.
Every path is redirected into tmp: a test never touches a real Claude setup."""

import json
import stat


def _client():
    from fastapi.testclient import TestClient

    from backend.api.app import create_app

    return TestClient(create_app(), base_url="http://127.0.0.1")


def test_desktop_config_is_merged_backed_up_and_reverted(data_dir, tmp_path, monkeypatch):
    cfg = tmp_path / "Claude" / "claude_desktop_config.json"
    cfg.parent.mkdir()
    cfg.write_text(json.dumps({"mcpServers": {"other": {"command": "x"}}, "theme": "dark"}))
    monkeypatch.setenv("LECTURE_STUDIO_CLAUDE_DESKTOP_CONFIG", str(cfg))
    monkeypatch.setenv("LECTURE_STUDIO_CLAUDE_CODE_CONFIG", str(tmp_path / "none.json"))
    with _client() as c:
        assert c.get("/api/system/mcp").json()["desktop"] == {"available": True, "connected": False, "where": str(cfg)}
        st = c.post("/api/system/mcp/desktop").json()
        assert st["desktop"]["connected"]
        data = json.loads(cfg.read_text())
        assert data["theme"] == "dark" and "other" in data["mcpServers"]  # the rest of the file is kept
        entry = data["mcpServers"]["lecture-studio"]
        assert entry["args"][-1] == "mcp_server.py" and "--directory" in entry["args"]
        assert json.loads(cfg.with_suffix(".json.bak").read_text())["mcpServers"] == {"other": {"command": "x"}}
        assert not c.delete("/api/system/mcp/desktop").json()["desktop"]["connected"]
        assert "lecture-studio" not in json.loads(cfg.read_text())["mcpServers"]


def test_no_desktop_app_is_said_plainly(data_dir, tmp_path, monkeypatch):
    monkeypatch.setenv("LECTURE_STUDIO_CLAUDE_DESKTOP_CONFIG", str(tmp_path / "missing" / "c.json"))
    with _client() as c:
        r = c.post("/api/system/mcp/desktop")
        assert r.status_code == 400 and "Claude Desktop" in r.json()["detail"]


def test_code_goes_through_the_claude_cli(data_dir, tmp_path, monkeypatch):
    log = tmp_path / "calls.txt"
    state = tmp_path / "claude.json"
    fake = tmp_path / "claude"
    # a stand-in for the claude command: logs its arguments and edits the config like the real one would
    fake.write_text(f"""#!/bin/sh
echo "$@" >> {log}
if [ "$2" = "add" ]; then echo '{{"mcpServers": {{"lecture-studio": {{}}}}}}' > {state}; fi
if [ "$2" = "remove" ]; then echo '{{"mcpServers": {{}}}}' > {state}; fi
""")
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("LECTURE_STUDIO_CLAUDE_BIN", str(fake))
    monkeypatch.setenv("LECTURE_STUDIO_CLAUDE_CODE_CONFIG", str(state))
    monkeypatch.setenv("LECTURE_STUDIO_CLAUDE_DESKTOP_CONFIG", str(tmp_path / "d" / "c.json"))
    with _client() as c:
        assert c.post("/api/system/mcp/code").json()["code"]["connected"]
        assert c.post("/api/system/mcp/code").json()["code"]["connected"]  # again: replaced, not doubled
        assert not c.delete("/api/system/mcp/code").json()["code"]["connected"]
    calls = log.read_text().splitlines()
    assert calls[0].startswith("mcp add --scope user lecture-studio -- ") and calls[0].endswith("python mcp_server.py")
    assert calls[1].startswith("mcp remove --scope user lecture-studio") and calls[2].startswith("mcp add")
