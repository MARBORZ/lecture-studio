"""
Self-update. Releases are git tags vX.Y.Z on origin, pre-releases vX.Y.Z-beta.N (also -alpha.N, -rc.N; older than
vX.Y.Z itself). APP_VERSION is what is running. Pre-releases are offered when the setting asks for them or a pre-release
runs; tags of other shapes (alpha-*, the old releases) are ignored.

  check() — fetch tags (cached), compare the newest with APP_VERSION, list the changes, say if it can be applied.
  discard_changes() — put the tracked files that block an update ("dirty") back to the committed version.
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
from typing import Literal

from backend import config
from backend.i18n import tr
from backend.models.system import UpdateBlock, UpdateInfo, UpdateOutcome
from backend.settings import SettingsService
from backend.utils.fs import read_json, remove_file, write_text

logger = logging.getLogger(__name__)

CACHE_SEC = 3600
FORCE_FLOOR_SEC = 30  # a page (re)load still reuses an answer this fresh: reload storms stay cheap
OUTCOME_SEC = 600
MAX_CHANGES = 40
LAUNCHER_WAIT_SEC = 15  # the launcher writes to launcher.log at once; silence after this long = it did not start
_TAG = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$")
_PRE_RANK = {"alpha": 0, "beta": 1, "rc": 2}
_FINAL = 3  # 1.0.0-rc.9 < 1.0.0

_lock = threading.Lock()
_cache: UpdateInfo | None = None
_last: UpdateOutcome | None = None
_restart_failed = False


class UpdateError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def parse_version(tag: str) -> tuple[int, int, int, int, int] | None:
    """Sort key: (major, minor, patch, stage, n); stage ranks alpha < beta < rc < the release."""
    m = _TAG.match(tag.strip())
    if not m:
        return None
    stage = (_PRE_RANK[m[4]], int(m[5])) if m[4] else (_FINAL, 0)
    return (int(m[1]), int(m[2]), int(m[3]), *stage)


def is_prerelease(tag: str) -> bool:
    key = parse_version(tag)
    return key is not None and key[3] != _FINAL


def _wants_prereleases() -> bool:
    return is_prerelease(config.APP_VERSION) or SettingsService.get().beta_updates


def _newest(tags: list[str]) -> str | None:
    """The highest version among tags; pre-releases only when wanted."""
    pre = _wants_prereleases()
    ok = [t for t in tags if parse_version(t) and (pre or not is_prerelease(t))]
    return max(ok, key=lambda t: parse_version(t) or ()) if ok else None


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
                tr("update.ownership", repo=repo),
            )
        raise UpdateError("git", message)
    return res.stdout


def is_git_install() -> bool:
    return (config.REPO_DIR / ".git").exists()


# ---------------------------------------------------------------- check


def _check_git() -> UpdateInfo:
    current = parse_version(config.APP_VERSION)
    _git("fetch", "--tags", "--force", "--quiet", "origin", timeout=60)
    tag = _newest(_git("tag", "-l", "v*").split())
    info = _info("git")
    info.current_released_at = _tag_date(f"v{config.APP_VERSION}")
    if not tag or not current or (parse_version(tag) or ()) <= current:
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
    """Tracked files that differ from HEAD, staged or not (line endings alone count too). Untracked files never block."""
    return [f for f in _git("diff", "--name-only", "--no-renames", "-z", "HEAD").split("\0") if f]


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


def _github_releases() -> list[dict]:
    """Published releases. Not /releases/latest: it skips pre-releases and is a 404 while there are only betas."""
    api = config.REPO_URL.replace("https://github.com/", "https://api.github.com/repos/") + "/releases?per_page=50"
    req = urllib.request.Request(api, headers={"Accept": "application/vnd.github+json", "User-Agent": "lecture-studio"})
    with urllib.request.urlopen(req, timeout=15) as res:
        return [r for r in json.load(res) if isinstance(r, dict) and not r.get("draft")]


def _check_zip() -> UpdateInfo:
    releases = {str(r.get("tag_name", "")): r for r in _github_releases()}
    tag = _newest(list(releases))
    info = _info("zip")
    current = parse_version(config.APP_VERSION)
    if tag and current and (parse_version(tag) or ()) > current:
        release = releases[tag]
        info.url = release.get("html_url") or info.url
        info.latest = tag.lstrip("v")
        info.released_at = release.get("published_at") or None
        info.available = True
        info.blocked = "zip"
        body = str(release.get("body") or "")
        info.changes = [line.lstrip("-* ").strip() for line in body.splitlines() if line.strip()][:MAX_CHANGES]
    return info


def _info(mode: Literal["git", "zip"]) -> UpdateInfo:
    return UpdateInfo(current=config.APP_VERSION, current_prerelease=is_prerelease(config.APP_VERSION), mode=mode, url=f"{config.REPO_URL}/releases")


def check(force: bool = False, reload: bool = False) -> UpdateInfo:
    """force: always ask origin (the Check button). reload: a page (re)load asks origin unless the answer is fresh."""
    global _cache
    with _lock:
        if not force and _cache and _cache.checked_at and time.time() - _cache.checked_at < (FORCE_FLOOR_SEC if reload else CACHE_SEC):
            info = _cache.model_copy()
        else:
            try:
                info = _check_git() if is_git_install() else _check_zip()
            except Exception as e:  # offline, git missing, GitHub rate limit: report, never raise
                logger.warning("Update check failed: %s", e)
                info = _info("git" if is_git_install() else "zip")
                info.error = str(e)[:500]
            info.checked_at = time.time()
            _cache = info.model_copy()
    info.last = _last if _last and time.time() - _last.at < OUTCOME_SEC else None
    info.restart_failed = _restart_failed
    return info


# ---------------------------------------------------------------- discard


def discard_changes() -> UpdateInfo:
    """Caller holds the system lock. The files are listed here, never taken from the request: only what blocks the
    update is reset. A file added to the index is unstaged and stays on disk as untracked (it does not block)."""
    files = _dirty_files()
    if files:
        _git("reset", "-q", "--", *files)
        committed = [f for f in _git("ls-tree", "-r", "--name-only", "-z", "HEAD", "--", *files).split("\0") if f]
        if committed:
            _git("checkout", "--", *committed)
        logger.info("Discarded local changes before the update: %s", ", ".join(files))
    return check(force=True)


# ---------------------------------------------------------------- apply


def apply() -> UpdateInfo:
    """Caller holds the system busy lock. Moves the code to the release and starts the launcher in update mode."""
    info = check(force=True)
    if info.error:
        raise UpdateError("check", info.error)
    if not info.available or not info.latest:
        raise UpdateError("none", tr("update.none"))
    if info.blocked:
        raise UpdateError(info.blocked, tr("update.blocked", reason=info.blocked))

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

