"""
Claude Code provider: the user's own installed and signed-in `claude`, run as is, so the work goes on their Claude
plan (docs/PROJECT_RULES.md, rule 9). Transport only: the prompt goes in on stdin, the system prompt as a flag, the
answer comes back as stream-json events.

  claude -p --output-format stream-json --verbose --include-partial-messages
         --model <sonnet|opus|haiku> --system-prompt <system> --tools "" --strict-mcp-config
         --no-session-persistence --disable-slash-commands

No tools and no MCP servers. The run happens in an empty temporary folder, so it cannot touch the repository or the
user's files, and the user's session list stays clean. Sign-in is Claude Code's own (`claude` in a terminal). The app
asks `claude auth status` whether that happened and reads nothing else of it: no credentials, tokens or keychain.

Paths can be overridden for tests (LECTURE_STUDIO_CLAUDE_BIN): a test never runs the real `claude`.
"""

import json
import logging
import os
import shutil
import subprocess
import tempfile
import threading
import time
from collections.abc import Iterable, Iterator
from contextlib import closing
from pathlib import Path
from typing import Any

from backend.core.ai import prompts
from backend.core.ai.base import BaseAIProvider
from backend.i18n import tr
from backend.utils.proc import stream_lines

logger = logging.getLogger(__name__)

STATUS_TIMEOUT = 15
STATUS_TTL = 30.0  # seconds a sign-in check is trusted: Settings and every provider list ask for it
ANSWER_TIMEOUT = 1800.0  # an audit part on Opus can take minutes
# the app's own Anthropic key (settings or .env) must not turn the user's plan into API billing
_DROP_ENV = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")


def claude_bin() -> str | None:
    return os.getenv("LECTURE_STUDIO_CLAUDE_BIN") or shutil.which("claude") or _known_claude()


def _known_claude() -> str | None:
    # the app is started from a shortcut: its PATH may lack the usual install places
    home = Path.home()
    names = ("claude.exe", "claude") if os.name == "nt" else ("claude",)
    for folder in (home / ".local/bin", home / ".claude/local", Path("/opt/homebrew/bin"), Path("/usr/local/bin")):
        for name in names:
            if (folder / name).is_file():
                return str(folder / name)
    return None


def _env(exe: str) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k not in _DROP_ENV}
    # claude finds node, git and its own helpers on PATH: the folder it lives in goes first
    env["PATH"] = os.pathsep.join([str(Path(exe).parent), env.get("PATH", "")])
    return env


_status: tuple[float, bool] | None = None
_status_lock = threading.Lock()


def signed_in() -> bool:
    """`claude` is installed and says it is signed in. Cached for STATUS_TTL; never raises."""
    global _status
    with _status_lock:
        if _status and time.monotonic() - _status[0] < STATUS_TTL:
            return _status[1]
        ok = _ask_status()
        _status = (time.monotonic(), ok)
        return ok


def forget_status() -> None:
    global _status
    with _status_lock:
        _status = None


def _ask_status() -> bool:
    exe = claude_bin()
    if not exe:
        return False
    try:
        r = subprocess.run(
            [exe, "auth", "status", "--json"], capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=STATUS_TIMEOUT, env=_env(exe), stdin=subprocess.DEVNULL,
        )
        return r.returncode == 0 and json.loads(r.stdout or "{}").get("loggedIn") is True
    except (OSError, subprocess.TimeoutExpired, ValueError, AttributeError) as e:
        logger.info("claude auth status: %s", e)
        return False


class ClaudeCodeError(RuntimeError):
    """For the user, already translated."""


def stream_text(lines: Iterable[str]) -> Iterator[str]:
    """The answer's text as `claude -p --output-format stream-json` writes it: the text deltas as they come; the final
    `result` event when no delta came. An error result raises ClaudeCodeError (also after text was shown)."""
    emitted = False
    started = time.monotonic()
    first: float | None = None
    for line in lines:
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            event = json.loads(line)
        except ValueError:
            continue
        kind = event.get("type")
        if kind == "stream_event":
            delta = (event.get("event") or {}).get("delta") or {}
            if delta.get("type") == "text_delta" and delta.get("text"):
                if first is None:
                    first = time.monotonic() - started
                emitted = True
                yield delta["text"]
        elif kind == "result":
            text = event.get("result")
            logger.info(
                "Claude Code: first text %.1fs, total %.1fs, %s",
                first if first is not None else -1, time.monotonic() - started, event.get("subtype", ""),
            )
            if event.get("is_error") or event.get("subtype") not in (None, "success"):
                raise ClaudeCodeError(_explain(str(text or event.get("subtype") or "")))
            if not emitted and isinstance(text, str) and text:
                yield text
            return
    if not emitted:
        raise ClaudeCodeError(tr("ai.claude_code_error", error=tr("ai.claude_code_empty")))


def parse_stream(lines: Iterable[str]) -> str:
    """The whole answer (stream_text joined)."""
    return "".join(stream_text(lines))


def _explain(message: str) -> str:
    low = message.lower()
    if "/login" in low or "not logged in" in low or "authenticat" in low or "oauth" in low:
        forget_status()
        return tr("ai.claude_code_login")
    return tr("ai.claude_code_error", error=message.strip()[:300])


class ClaudeCodeProvider(BaseAIProvider):
    category = "claude_code"
    default_model = "sonnet"
    supported_models = ["sonnet", "opus", "haiku"]  # Claude Code's aliases: the plan decides which version they mean
    max_context_tokens = 200_000  # every Claude model takes 200k; a larger window depends on the plan
    default_context_tokens = 128_000

    needs_key = False  # the user's own `claude`, signed in by itself

    def _command(self, exe: str, system: str) -> list[str]:
        cmd = [
            exe, "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
            "--model", self.model, "--tools", "", "--strict-mcp-config", "--no-session-persistence",
            "--disable-slash-commands",
        ]
        return [*cmd, "--system-prompt", system] if system else cmd

    def _stream(self, prompt: str, system: str) -> Iterator[str]:
        exe = claude_bin()
        if not exe:
            raise ClaudeCodeError(tr("ai.claude_code_missing"))
        with tempfile.TemporaryDirectory(prefix="lecture-studio-claude-") as cwd:
            try:
                # the result event is the last one: closing the stream then stops a `claude` that has not exited yet
                with closing(stream_lines(self._command(exe, system), prompt, cwd, _env(exe), ANSWER_TIMEOUT)) as lines:
                    yield from stream_text(lines)
            except subprocess.TimeoutExpired as e:
                raise ClaudeCodeError(tr("ai.claude_code_timeout", minutes=int(ANSWER_TIMEOUT // 60))) from e
            except subprocess.CalledProcessError as e:
                raise ClaudeCodeError(_explain(e.stderr or str(e))) from e
            except OSError as e:
                raise ClaudeCodeError(tr("ai.claude_code_error", error=str(e)[:300])) from e

    def chat(self, messages: list[dict[str, str]], system: str = "", temperature: float = 0.2, **kwargs: Any) -> str:
        return "".join(self._stream(prompts.conversation_prompt(messages), system))

    def stream_chat(self, messages: list[dict[str, str]], system: str = "", temperature: float = 0.2, **kwargs: Any) -> Iterator[str]:
        return self._stream(prompts.conversation_prompt(messages), system)
