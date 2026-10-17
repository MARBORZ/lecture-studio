"""
Claude Code provider: the user's own `claude`, faked here by a script on LECTURE_STUDIO_CLAUDE_BIN (no test runs the
real one). The stream parser, the sign-in check, a full answer, and what the user reads when it fails.
"""

import json
import os
import stat
import sys
import textwrap

import pytest

STREAM = [
    {"type": "system", "subtype": "init", "model": "claude-sonnet"},
    {"type": "stream_event", "event": {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Ответ "}}},
    {"type": "stream_event", "event": {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "[01:05]"}}},
    {"type": "assistant", "message": {"content": [{"type": "text", "text": "Ответ [01:05]"}]}},
    {"type": "result", "subtype": "success", "is_error": False, "result": "Ответ [01:05]"},
]


def lines(events):
    return [json.dumps(e, ensure_ascii=False) + "\n" for e in events]


def test_parse_takes_the_result_event():
    from backend.core.ai.providers.claude_code import parse_stream

    assert parse_stream(["not json\n", *lines(STREAM)]) == "Ответ [01:05]"


def test_parse_falls_back_to_deltas_and_reports_errors():
    from backend.core.ai.providers.claude_code import ClaudeCodeError, parse_stream

    assert parse_stream(lines(STREAM[:3])) == "Ответ [01:05]"
    with pytest.raises(ClaudeCodeError, match="claude"):
        parse_stream(lines([{"type": "result", "subtype": "success", "is_error": True, "result": "Not logged in · Please run /login"}]))
    with pytest.raises(ClaudeCodeError):
        parse_stream([])


FAKE = """
    import json, sys
    args = sys.argv[1:]
    if args[:2] == ["auth", "status"]:
        print(json.dumps({"loggedIn": %(logged)s}))
        sys.exit(0)
    assert args[0] == "-p" and "--tools" in args and "--strict-mcp-config" in args, args
    prompt = sys.stdin.read()
    system = args[args.index("--system-prompt") + 1] if "--system-prompt" in args else ""
    model = args[args.index("--model") + 1]
    text = f"{model}|{system}|{prompt}"
    for e in [{"type": "stream_event", "event": {"delta": {"type": "text_delta", "text": text}}},
              {"type": "result", "subtype": "success", "is_error": False, "result": text}]:
        print(json.dumps(e, ensure_ascii=False), flush=True)
"""


@pytest.fixture()
def fake_claude(tmp_path, monkeypatch):
    def make(logged_in=True):
        script = tmp_path / "claude"
        script.write_text(f"#!{sys.executable}\n" + textwrap.dedent(FAKE % {"logged": "True" if logged_in else "False"}), "utf-8")
        script.chmod(script.stat().st_mode | stat.S_IEXEC)
        monkeypatch.setenv("LECTURE_STUDIO_CLAUDE_BIN", str(script))
        from backend.core.ai.providers import claude_code

        monkeypatch.setattr(claude_code, "_ask_status", claude_code.REAL_ASK_STATUS)
        claude_code.forget_status()
        return script

    return make


@pytest.mark.skipif(os.name == "nt", reason="the fake is a shebang script")
def test_answer_through_the_users_claude(fake_claude, monkeypatch):
    from backend.core.ai.providers.claude_code import ClaudeCodeProvider, signed_in

    fake_claude()
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-should-not-pass")
    assert signed_in()
    p = ClaudeCodeProvider(model="haiku")
    assert p.generate_text("вопрос", system="роль") == "haiku|роль|вопрос"
    answer = p.chat([{"role": "user", "content": "раз"}, {"role": "assistant", "content": "два"}, {"role": "user", "content": "три"}])
    assert answer.startswith("haiku||") and "раз" in answer and "три" in answer


@pytest.mark.skipif(os.name == "nt", reason="the fake is a shebang script")
def test_not_signed_in_is_not_configured(fake_claude):
    from backend.core.ai.facade import AI

    fake_claude(logged_in=False)
    assert not AI.configured("claude_code")
    assert "claude" in AI.not_configured("claude_code")


def test_the_apps_key_never_reaches_claude(monkeypatch):
    from backend.core.ai.providers.claude_code import _env

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-x")
    env = _env("/somewhere/bin/claude")
    assert "ANTHROPIC_API_KEY" not in env and env["PATH"].startswith("/somewhere/bin")
