"""
Self-update. Releases are git tags vX.Y.Z on origin; APP_VERSION is what is running.

  check() — fetch tags (cached), compare the newest with APP_VERSION, list the changes, say if it can be applied.
  apply() — fast-forward the current branch to the release tag, write the hand-over file, start the launcher
            in update mode. The launcher restarts everything (deps re-sync by lockfile hash, keeps the app window)
            and rolls back to the previous commit if the new version does not come up. If the launcher itself never
            starts (antivirus, policy), this server is still alive a few seconds later: check() reports restart_failed.
  consume_outcome() — on startup: did the last update land (version matches) or was it rolled back.
                      Reported by check() for OUTCOME_SEC: the page reloads more than once around a restart.

Installs without .git (release zip) only get a notice with a link to the release.
"""

import json
import logging
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request

from backend import config
from backend.models.system import UpdateBlock, UpdateInfo, UpdateOutcome
from backend.utils.fs import read_json, remove_file, write_text

logger = logging.getLogger(__name__)

CACHE_SEC = 3600
OUTCOME_SEC = 600
MAX_CHANGES = 40
LAUNCHER_WAIT_SEC = 15  # the launcher writes to launcher.log at once; silence after this long = it did not start
_TAG = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")

_lock = threading.Lock()
_cache: UpdateInfo | None = None
_last: UpdateOutcome | None = None
_restart_failed = False


class UpdateError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def parse_version(tag: str) -> tuple[int, int, int] | None:
    m = _TAG.match(tag.strip())
    return (int(m[1]), int(m[2]), int(m[3])) if m else None


def handover_file():
    return config.STATE_DIR / "update.json"


def _git(*args: str, timeout: float = 30) -> str:
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    # Always UTF-8: without it Windows decodes git output as cp1252 and release notes show "â€“" for "–".
    res = subprocess.run(
        ["git", *args], cwd=config.REPO_DIR, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout
    )
    if res.returncode != 0:
        message = (res.stderr or res.stdout).strip() or f"git {args[0]} failed"
        if "dubious ownership" in message:
            # The folder belongs to another account (e.g. created by an administrator): git refuses until told to trust it.
            repo = config.REPO_DIR.as_posix()
            raise UpdateError(
                "ownership",
                f'Git не доверяет папке приложения (detected dubious ownership). Выполните в терминале: git config --global --add safe.directory "{repo}"',
            )
        raise UpdateError("git", message)
    return res.stdout


def is_git_install() -> bool:
    return (config.REPO_DIR / ".git").exists()


# ---------------------------------------------------------------- check


def _newest_tag() -> str | None:
    tags = [t for t in _git("tag", "-l", "v*").split() if parse_version(t)]
    return max(tags, key=parse_version) if tags else None


def _check_git() -> UpdateInfo:
    current = parse_version(config.APP_VERSION)
    _git("fetch", "--tags", "--force", "--quiet", "origin", timeout=60)
    tag = _newest_tag()
    info = UpdateInfo(current=config.APP_VERSION, mode="git", url=f"{config.REPO_URL}/releases")
    info.current_released_at = _tag_date(f"v{config.APP_VERSION}")
    if not tag or parse_version(tag) <= current:
        return info
    info.latest = tag.lstrip("v")
    info.released_at = _tag_date(tag)
    info.available = True
    info.url = f"{config.REPO_URL}/releases/tag/{tag}"
    info.changes = _release_notes(tag)
    info.blocked = _block_reason(tag)
    if info.blocked == "dirty":
        info.dirty_files = _dirty_files()[:MAX_CHANGES]
    return info


def _tag_date(tag: str) -> str | None:
    """When the release was made (ISO): the tag date for an annotated tag, the commit date for a lightweight one.
    Shown next to the version only: which release is newer is always decided by the number."""
    return _git("for-each-ref", "--format=%(creatordate:iso-strict)", f"refs/tags/{tag}").strip() or None


def _release_notes(tag: str) -> list[str]:
    """Annotated tag body (curated notes, one "- item" per line); a lightweight tag falls back to commit subjects."""
    if _git("cat-file", "-t", tag).strip() == "tag":
        body = _git("tag", "-l", "--format=%(contents:body)", tag)
        notes = [line.lstrip("-* ").strip() for line in body.splitlines() if line.strip() and not line.startswith("-----BEGIN")]
        if notes:
            return notes[:MAX_CHANGES]
    log = _git("log", "--no-merges", f"--max-count={MAX_CHANGES}", "--format=%s", f"HEAD..{tag}")
    return [line for line in log.splitlines() if line.strip()]


def _dirty_files() -> list[str]:
    """Tracked files with local changes ("XY path" lines of porcelain status)."""
    return [line[3:] for line in _git("status", "--porcelain", "--untracked-files=no").splitlines() if line.strip()]


def _block_reason(tag: str) -> UpdateBlock | None:
    if sys.platform not in ("darwin", "win32"):
        return "platform"
    if _dirty_files():
        return "dirty"
    try:
        _git("merge-base", "--is-ancestor", "HEAD", tag)
    except UpdateError:
        return "diverged"  # local commits that the release does not contain
    return None


def _check_zip() -> UpdateInfo:
    api = config.REPO_URL.replace("https://github.com/", "https://api.github.com/repos/") + "/releases/latest"
    req = urllib.request.Request(api, headers={"Accept": "application/vnd.github+json", "User-Agent": "lecture-studio"})
    with urllib.request.urlopen(req, timeout=15) as res:
        release = json.load(res)
    tag = str(release.get("tag_name", ""))
    info = UpdateInfo(current=config.APP_VERSION, mode="zip", url=release.get("html_url") or f"{config.REPO_URL}/releases")
    version = parse_version(tag)
    if version and version > parse_version(config.APP_VERSION):
        info.latest = tag.lstrip("v")
        info.released_at = release.get("published_at") or None
        info.available = True
        info.blocked = "zip"
        body = str(release.get("body") or "")
        info.changes = [line.lstrip("-* ").strip() for line in body.splitlines() if line.strip()][:MAX_CHANGES]
    return info


def check(force: bool = False) -> UpdateInfo:
    global _cache
    with _lock:
        if not force and _cache and _cache.checked_at and time.time() - _cache.checked_at < CACHE_SEC:
            info = _cache.model_copy()
        else:
            try:
                info = _check_git() if is_git_install() else _check_zip()
            except Exception as e:  # offline, git missing, GitHub rate limit: report, never raise
                logger.warning("Update check failed: %s", e)
                info = UpdateInfo(current=config.APP_VERSION, mode="git" if is_git_install() else "zip", url=f"{config.REPO_URL}/releases", error=str(e)[:500])
            info.checked_at = time.time()
            _cache = info.model_copy()
    info.last = _last if _last and time.time() - _last.at < OUTCOME_SEC else None
    info.restart_failed = _restart_failed
    return info


# ---------------------------------------------------------------- apply


def apply() -> UpdateInfo:
    """Caller holds the system busy lock. Moves the code to the release and starts the launcher in update mode."""
    info = check(force=True)
    if info.error:
        raise UpdateError("check", info.error)
    if not info.available or not info.latest:
        raise UpdateError("none", "Нет доступного обновления")
    if info.blocked:
        raise UpdateError(info.blocked, f"Обновление из приложения невозможно: {info.blocked}")

    from_sha = _git("rev-parse", "HEAD").strip()
    config.STATE_DIR.mkdir(parents=True, exist_ok=True)
    write_text(
        handover_file(),
        json.dumps({"from_sha": from_sha, "from_version": config.APP_VERSION, "to_version": info.latest}),
    )
    try:
        _git("merge", "--ff-only", "--quiet", f"v{info.latest}")
    except UpdateError:
        remove_file(handover_file())
        raise
    logger.info("Updated code %s -> v%s (%s), restarting through the launcher", config.APP_VERSION, info.latest, from_sha[:8])
    threading.Timer(0.8, _restart).start()
    return info


def _restart() -> None:
    since = time.time()
    spawn_launcher()
    watch = threading.Timer(LAUNCHER_WAIT_SEC, lambda: _verify_launcher(since))
    watch.daemon = True
    watch.start()


def _verify_launcher(since: float) -> None:
    """Runs on the old server, so reaching this point means the launcher did not stop it. If launcher.log was not
    touched since the spawn, the launcher never started: the code is already updated, the restart is not."""
    global _restart_failed
    try:
        started = (config.LOGS_DIR / "launcher.log").stat().st_mtime > since
    except OSError:
        started = False
    if started:
        return  # still working (dependency install): the page keeps waiting
    _restart_failed = True
    logger.error("Launcher did not start within %ss after the update: restart failed, code is already updated", LAUNCHER_WAIT_SEC)


def spawn_launcher() -> None:
    """Start the launcher detached from this process: it stops this server, so it must outlive it."""
    common = {"cwd": config.REPO_DIR, "stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
    if sys.platform == "win32":
        # The way the Desktop shortcut starts it. A hidden detached powershell.exe spawned from Python is silently killed
        # on some machines (antivirus) before it logs anything.
        script = config.REPO_DIR / "launcher" / "windows" / "start.vbs"
        wscript = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "System32", "wscript.exe")
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
        subprocess.Popen([wscript, str(script), "update"], creationflags=flags, **common)
    else:
        script = config.REPO_DIR / "launcher" / "macos" / "start.zsh"
        subprocess.Popen(["/bin/zsh", str(script), "update"], start_new_session=True, **common)


# ---------------------------------------------------------------- outcome


def consume_outcome() -> None:
    """Startup: compare the hand-over with the running version. The launcher deletes the file when it is done."""
    global _last
    data = read_json(handover_file(), default=None)
    if not isinstance(data, dict) or "to_version" not in data:
        return
    _last = UpdateOutcome(
        from_version=str(data.get("from_version", "")), to_version=str(data["to_version"]), ok=config.APP_VERSION == data["to_version"], at=time.time()
    )
    logger.info("Update outcome: %s", _last)

