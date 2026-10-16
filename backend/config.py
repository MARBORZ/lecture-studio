"""
Static, process-wide constants. Everything user-configurable lives in backend.settings.
"""

import os
import re
import sys
import tomllib
from pathlib import Path

from dotenv import load_dotenv

# Windows without Developer Mode keeps the model cache as copies, not symlinks, and huggingface_hub warns about it on every load.
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

APP_NAME = "Lecture Studio"
REPO_DIR = Path(__file__).resolve().parent.parent

# The one version source is pyproject.toml (release: `uv version X.Y.Z`, commit, tag vX.Y.Z).
# A pre-release is written the Python way (1.0.0b1) and named the way it is tagged (1.0.0-beta.1, tag v1.0.0-beta.1).
_PRE_NAMES = {"a": "alpha", "b": "beta", "rc": "rc"}


def release_name(version: str) -> str:
    m = re.fullmatch(r"(\d+\.\d+\.\d+)(a|b|rc)(\d+)", version)
    return f"{m[1]}-{_PRE_NAMES[m[2]]}.{m[3]}" if m else version


with open(REPO_DIR / "pyproject.toml", "rb") as _f:
    APP_VERSION: str = release_name(tomllib.load(_f)["project"]["version"])

# Machine-local home: settings.json, pid file, logs, launcher state, Chrome app profile.
# Lives outside the repository and outside the data dir so paths can change freely.
def _default_home() -> Path:
    if sys.platform == "darwin":
        return Path("~/Library/Application Support/Lecture Studio").expanduser()
    if sys.platform == "win32":
        return Path(os.getenv("APPDATA") or Path.home() / "AppData" / "Roaming") / "Lecture Studio"
    return Path(os.getenv("XDG_DATA_HOME") or "~/.local/share").expanduser() / "lecture-studio"


APP_HOME = Path(os.getenv("LECTURE_STUDIO_HOME") or _default_home()).expanduser()

SETTINGS_FILE = APP_HOME / "settings.json"
PID_FILE = APP_HOME / "server.pid"
FRONTEND_PID_FILE = APP_HOME / "frontend.pid"
LOGS_DIR = APP_HOME / "logs"
CHROME_PROFILE_DIR = APP_HOME / "chrome-profile"
STATE_DIR = APP_HOME / "state"  # launcher fingerprints, update hand-over (update.json)
FEEDBACK_DIR = APP_HOME / "feedback"  # bug reports: drafts being filled, the outbox of unsent ones, the send log

# Releases are git tags vX.Y.Z on this repository.
REPO_URL = "https://github.com/MARBORZ/lecture-studio"

# Bug reports go to a small relay (feedback-relay/, a Vercel function) that mails them to the developer.
# The relay holds the mail password; the app holds nothing secret. Empty: reports wait in the outbox.
FEEDBACK_URL = os.getenv("LECTURE_STUDIO_FEEDBACK_URL", "")

# Default data location for a fresh install (existing installs keep whatever settings.json says).
DEFAULT_DATA_DIR = REPO_DIR / "workspace"

# Backend API on 3000; the UI is the Vite server on 5173 (proxies /api here).
# LS_API_PORT / LS_UI_PORT: a second instance next to the running app (same names as vite.config.ts and the launcher).
HOST = "127.0.0.1"
PORT = int(os.getenv("LS_API_PORT") or 3000)
FRONTEND_PORT = int(os.getenv("LS_UI_PORT") or 5173)
FRONTEND_ORIGINS = [f"http://127.0.0.1:{FRONTEND_PORT}", f"http://localhost:{FRONTEND_PORT}"]

# .env is only a fallback source for API keys (settings.json takes precedence).
load_dotenv(REPO_DIR / ".env")
