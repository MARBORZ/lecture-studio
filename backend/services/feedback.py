"""
Bug reports and ideas from the app to the developer's mail.

  new_draft()        — a folder for one report; remembers when the form opened (a person needs a few seconds)
  file_slot() / register_file() / remove_file() — attachments, checked by type, size, count and total
  send(id, form)     — honeypot filled or sent too fast -> quietly dropped (answered as sent, a bot learns nothing);
                       cooldown and daily limit -> TooSoon; diagnostics (version, OS, compute, log tails with secrets
                       masked) added on request; delivered to FEEDBACK_URL, or kept in the outbox when that fails
  flush()            — retry the outbox (startup, before each send)
  cleanup()          — drafts never sent are removed after a day

  <FEEDBACK_DIR>/drafts/<id>/meta.json, files/   a form being filled
  <FEEDBACK_DIR>/outbox/<id>/report.json, files/ a report waiting for the relay
  <FEEDBACK_DIR>/sent.json                       send times (cooldown, daily limit)

The app holds no secret: the relay (feedback-relay/) owns the mail password and checks the same limits again.
"""

import logging
import mimetypes
import platform
import re
import shutil
import threading
import time
import uuid
from pathlib import Path

import httpx

from backend import config
from backend.i18n import tr
from backend.models.feedback import FeedbackDraft, FeedbackFile, FeedbackLimits, FeedbackResult, FeedbackSend
from backend.settings.service import SettingsService
from backend.utils.fs import read_json, read_text, remove_dir, sanitize_filename, write_json, write_text

logger = logging.getLogger(__name__)

MAX_FILES = 5
MAX_TOTAL_BYTES = 4 * 1024 * 1024  # the relay takes 4.5 MB per request (Vercel); the form shrinks screenshots first
MAX_FILE_BYTES = MAX_TOTAL_BYTES
MIN_MESSAGE, MAX_MESSAGE, MAX_CONTACT = 10, 5000, 200
MIN_FILL_SEC = 3  # faster than this is not a person typing
COOLDOWN_SEC = 60
DAILY_LIMIT = 10
EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".pdf", ".txt", ".log", ".md", ".json", ".zip"]
DRAFT_TTL = 24 * 3600
LOG_TAIL = 200  # lines per log in the diagnostics
SEND_TIMEOUT = 60

_ID = re.compile(r"[a-f0-9]{12}")
# API keys never reach the logs, but a pasted error message might carry one: mask anything key-shaped.
_SECRET = re.compile(r"(sk-[A-Za-z0-9_\-]{8,}|AIza[0-9A-Za-z_\-]{20,}|re_[A-Za-z0-9_]{16,}|[A-Za-z0-9_\-]{32,})")
_lock = threading.Lock()

LIMITS = FeedbackLimits(
    max_files=MAX_FILES, max_file_bytes=MAX_FILE_BYTES, max_total_bytes=MAX_TOTAL_BYTES, min_message=MIN_MESSAGE,
    max_message=MAX_MESSAGE, max_contact=MAX_CONTACT, cooldown_sec=COOLDOWN_SEC, daily_limit=DAILY_LIMIT,
    extensions=EXTENSIONS,
)


class FeedbackError(ValueError):
    """The report cannot be accepted as it is (the message says why)."""


class TooSoon(Exception):
    def __init__(self, retry_after: int):
        super().__init__(tr("feedback.too_soon", sec=retry_after))
        self.retry_after = retry_after


# ---------------- places ----------------

def _drafts() -> Path:
    return config.FEEDBACK_DIR / "drafts"


def _outbox() -> Path:
    return config.FEEDBACK_DIR / "outbox"


def _draft(draft_id: str) -> Path:
    if not _ID.fullmatch(draft_id) or not (_drafts() / draft_id / "meta.json").is_file():
        raise FeedbackError(tr("feedback.no_draft"))
    return _drafts() / draft_id


def _files(folder: Path) -> list[Path]:
    d = folder / "files"
    return sorted(p for p in d.iterdir() if p.is_file()) if d.is_dir() else []


# ---------------- limits ----------------

def _sent_times() -> list[float]:
    day_ago = time.time() - 24 * 3600
    return [t for t in read_json(config.FEEDBACK_DIR / "sent.json", []) if isinstance(t, int | float) and t > day_ago]


def retry_after() -> int:
    """Seconds until the next report may go: the cooldown after the last one, or the oldest of today's to age out."""
    times, now = _sent_times(), time.time()
    if not times:
        return 0
    wait = COOLDOWN_SEC - (now - max(times))
    if len(times) >= DAILY_LIMIT:
        wait = max(wait, min(times) + 24 * 3600 - now)
    return max(0, int(wait + 0.999))


def _mark_sent() -> None:
    write_json(config.FEEDBACK_DIR / "sent.json", [*_sent_times(), time.time()])


# ---------------- drafts and files ----------------

def new_draft() -> FeedbackDraft:
    draft_id = uuid.uuid4().hex[:12]
    write_json(_drafts() / draft_id / "meta.json", {"created_at": time.time()})
    return FeedbackDraft(id=draft_id, limits=LIMITS, retry_after=retry_after())


def file_slot(draft_id: str, filename: str) -> tuple[Path, int]:
    """Where an upload goes and how many bytes it may have (per-file and total caps). Refuses type and count."""
    folder = _draft(draft_id)
    name = sanitize_filename(Path(filename).name, "file") or "file"
    if Path(name).suffix.lower() not in EXTENSIONS:
        raise FeedbackError(tr("feedback.bad_type", types=" ".join(EXTENSIONS)))
    files = [p for p in _files(folder) if p.name != name]
    if len(files) >= MAX_FILES:
        raise FeedbackError(tr("feedback.too_many", n=MAX_FILES))
    room = MAX_TOTAL_BYTES - sum(p.stat().st_size for p in files)
    if room <= 0:
        raise FeedbackError(tr("feedback.too_big", mb=MAX_TOTAL_BYTES // (1024 * 1024)))
    (folder / "files").mkdir(parents=True, exist_ok=True)
    return folder / "files" / name, min(MAX_FILE_BYTES, room)


def remove_file(draft_id: str, filename: str) -> None:
    target = _draft(draft_id) / "files" / (sanitize_filename(Path(filename).name, "file") or "file")
    target.unlink(missing_ok=True)


def discard(draft_id: str) -> None:
    if _ID.fullmatch(draft_id):
        remove_dir(_drafts() / draft_id)


def file_info(path: Path) -> FeedbackFile:
    return FeedbackFile(name=path.name, size=path.stat().st_size)


# ---------------- sending ----------------

def _diagnostics() -> str:
    from backend.core import compute  # torch import on first use: only when a report asks for diagnostics
    from backend.services.updates import is_git_install

    s = SettingsService.get()
    try:
        plan = compute.plan(s.compute.device, s.compute.cpu_threads, s.compute.quiet)
        recognition = f"{plan.backend} {plan.gpu_name} threads={plan.threads} {plan.reason}".strip()
    except Exception as e:
        recognition = f"unknown ({e})"
    lines = [
        f"Lecture Studio {config.APP_VERSION}",
        f"OS: {platform.platform()} ({platform.machine()})",
        f"Python: {platform.python_version()}",
        f"Interface: {s.ui_language}",
        f"Recognition: {recognition}",
        f"Install: {'git' if is_git_install() else 'zip'}",
    ]
    for name in ("server.log", "launcher.log"):
        tail = read_text(config.LOGS_DIR / name).splitlines()[-LOG_TAIL:]
        if tail:
            lines += ["", f"---- {name} (last {len(tail)} lines)", *tail]
    return _SECRET.sub("***", "\n".join(lines))


def send(draft_id: str, form: FeedbackSend) -> FeedbackResult:
    folder = _draft(draft_id)
    meta = read_json(folder / "meta.json", {})
    # bots: the hidden field filled, or the form sent before a person could have read it. Answer as if sent.
    if form.website.strip() or time.time() - float(meta.get("created_at", 0)) < MIN_FILL_SEC:
        logger.info("Feedback dropped as automated (honeypot or too fast)")
        discard(draft_id)
        return FeedbackResult(status="sent", outbox=len(_queued()))
    message, contact = form.message.strip(), form.contact.strip()
    if len(message) < MIN_MESSAGE:
        raise FeedbackError(tr("feedback.too_short", n=MIN_MESSAGE))
    if len(message) > MAX_MESSAGE or len(contact) > MAX_CONTACT:
        raise FeedbackError(tr("feedback.too_long", n=MAX_MESSAGE))
    with _lock:
        wait = retry_after()
        if wait:
            raise TooSoon(wait)
        report = {
            "kind": form.kind, "message": message, "contact": contact, "version": config.APP_VERSION,
            "os": f"{platform.system()} {platform.release()}", "language": SettingsService.get().ui_language,
            "created_at": time.time(),
        }
        if form.diagnostics:
            write_text(folder / "files" / "diagnostics.txt", _diagnostics())
        write_json(folder / "report.json", report)
        (folder / "meta.json").unlink(missing_ok=True)
        target = _outbox() / draft_id
        _outbox().mkdir(parents=True, exist_ok=True)
        shutil.move(str(folder), str(target))
        _mark_sent()
    delivered = _deliver(target)
    if delivered:
        flush()  # older reports ride along once the relay answers
    return FeedbackResult(status="sent" if delivered else "queued", outbox=len(_queued()))


def _queued() -> list[Path]:
    box = _outbox()
    return sorted(p for p in box.iterdir() if (p / "report.json").is_file()) if box.is_dir() else []


def _deliver(folder: Path) -> bool:
    """Post one outbox report to the relay; on success the folder goes. False = keep it for later."""
    if not config.FEEDBACK_URL:
        logger.warning("Feedback relay URL is not set (LECTURE_STUDIO_FEEDBACK_URL): the report waits in the outbox")
        return False
    report = read_json(folder / "report.json", {})
    files = [("files", (p.name, p.read_bytes(), mimetypes.guess_type(p.name)[0] or "application/octet-stream")) for p in _files(folder)]
    try:
        r = httpx.post(
            config.FEEDBACK_URL,
            data={k: str(v) for k, v in report.items()},
            files=files or None,
            headers={"X-Lecture-Studio": config.APP_VERSION},
            timeout=SEND_TIMEOUT,
        )
    except httpx.HTTPError as e:
        logger.warning("Feedback not delivered (%s): kept in the outbox", e)
        return False
    if r.status_code >= 400:
        logger.warning("Feedback relay answered %s: %s", r.status_code, r.text[:300])
        return False
    remove_dir(folder)
    logger.info("Feedback delivered")
    return True


def flush() -> int:
    """Send what waits in the outbox; returns how many went."""
    return sum(_deliver(folder) for folder in _queued())


def cleanup() -> None:
    """Startup: drop drafts older than a day (forms opened and abandoned)."""
    box = _drafts()
    if not box.is_dir():
        return
    for d in box.iterdir():
        created = read_json(d / "meta.json", {}).get("created_at", 0)
        if time.time() - float(created or 0) > DRAFT_TTL:
            remove_dir(d)
