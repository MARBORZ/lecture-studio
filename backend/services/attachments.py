"""
Chat attachments: any file can be attached; readable formats are turned into text for the model.

A file belongs to its session and lives in the session's own folder, from the moment it is added (a pasted
screenshot is kept even if the clipboard moves on), until the session is cleared or deleted:

  <data_dir>/sessions/<session>/local_session_src/<id>/<file>         the original file (downloadable)
  <data_dir>/sessions/<session>/local_session_src/<id>/meta.json      Attachment
  <data_dir>/sessions/<session>/local_session_src/<id>/content.txt    extracted text (when readable)

It goes to the model only with the message it is attached to; any later message can attach it again (no re-upload).
An upload without a session waits in <data_dir>/attachments/<id>/ and moves into the session when sent (adopt).

Extractors are registered per kind/extension (open for extension: add a function, nothing else changes).
Images are not turned into text: they go to Gemini as images; DeepSeek cannot see them.
"""

import logging
import mimetypes
import re
import shutil
import time
import uuid
import zipfile
from collections.abc import Callable, Iterable
from pathlib import Path

from backend.i18n import tr
from backend.models.assistant import Attachment
from backend.settings import paths
from backend.utils.fs import read_json, read_text, sanitize_filename, write_json, write_text

logger = logging.getLogger(__name__)

MAX_TEXT = 200_000  # characters kept per attachment
MAX_BYTES = 500 * 1024 * 1024
ORPHAN_TTL = 24 * 3600  # uploaded but never sent

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".heif"}
TEXT_EXT = {
    ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".env", ".xml",
    ".html", ".htm", ".css", ".scss", ".srt", ".vtt", ".log", ".sql", ".sh", ".zsh", ".bash", ".ps1", ".bat",
    ".py", ".ipynb", ".js", ".jsx", ".ts", ".tsx", ".java", ".kt", ".go", ".rs", ".c", ".h", ".cpp", ".hpp", ".cs",
    ".rb", ".php", ".swift", ".dart", ".lua", ".r", ".m", ".tex", ".rst", ".gitignore", ".dockerfile",
}


SESSION_FILES = "local_session_src"


def root() -> Path:
    """Uploads not yet in a session."""
    return paths().attachments


def session_files_dir(session_id: str) -> Path:
    if not re.fullmatch(r"ses_[0-9a-f]{8}", session_id):
        raise ValueError(tr("chat.session_not_found"))
    return paths().sessions / session_id / SESSION_FILES


def new_slot(filename: str, session_id: str = "") -> tuple[str, Path]:
    """Reserve an id and a target path for an incoming upload: in the session's folder when it is known."""
    att_id = uuid.uuid4().hex[:12]
    folder = (session_files_dir(session_id) if session_id else root()) / att_id
    folder.mkdir(parents=True, exist_ok=True)
    return att_id, folder / (sanitize_filename(Path(filename).name, "file") or "file")


# ---------------- extractors ----------------

def _decode(data: bytes) -> str | None:
    if b"\x00" in data[:8192]:
        return None
    for enc in ("utf-8-sig", "cp1251", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return None


def _xml_text(xml: str) -> str:
    xml = re.sub(r"</(w:p|a:p|row)>", "\n", xml)
    return re.sub(r"[ \t]+", " ", re.sub(r"<[^>]+>", "", xml)).strip()


def _office(path: Path, members: Callable[[list[str]], Iterable[str]]) -> str:
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        return "\n\n".join(_xml_text(z.read(n).decode("utf-8", "replace")) for n in members(names))


def extract_pdf(path: Path) -> str:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    return "\n\n".join(f"[page {i}]\n{(p.extract_text() or '').strip()}" for i, p in enumerate(reader.pages, 1))


def _slide_no(name: str) -> int:
    m = re.search(r"(\d+)\.xml$", name)
    return int(m.group(1)) if m else 0


EXTRACTORS: dict[str, Callable[[Path], str]] = {
    ".pdf": extract_pdf,
    ".docx": lambda p: _office(p, lambda ns: [n for n in ns if n == "word/document.xml"]),
    ".pptx": lambda p: _office(p, lambda ns: sorted((n for n in ns if re.match(r"ppt/slides/slide\d+\.xml$", n)), key=_slide_no)),
    ".xlsx": lambda p: _office(p, lambda ns: [n for n in ns if n == "xl/sharedStrings.xml"]),
}


def _classify(path: Path) -> tuple[str, str, str]:
    """-> (kind, extracted text, note)"""
    ext = path.suffix.lower() or ("." + path.name.lower() if path.name.startswith(".") else "")
    if ext in IMAGE_EXT:
        return "image", "", tr("attachment.image")
    if ext in EXTRACTORS:
        try:
            return "document", EXTRACTORS[ext](path), ""
        except Exception as e:  # damaged or encrypted documents
            logger.warning("Extract failed for %s: %s", path.name, e)
            return "binary", "", tr("attachment.unreadable_doc")
    with open(path, "rb") as f:
        data = f.read(MAX_TEXT * 4)  # only the head: a multi-GB video must not be loaded to be classified
    text = _decode(data)
    if text is not None and (ext in TEXT_EXT or _mostly_printable(text)):
        return "text", text, ""
    return "binary", "", tr("attachment.binary")


def _mostly_printable(text: str) -> bool:
    sample = text[:4000]
    return bool(sample) and sum(ch.isprintable() or ch in "\n\r\t" for ch in sample) / len(sample) > 0.95


def register(att_id: str, path: Path, session_id: str = "") -> Attachment:
    kind, text, note = _classify(path)
    if len(text) > MAX_TEXT:
        text, note = text[:MAX_TEXT], tr("attachment.truncated", k=MAX_TEXT // 1000)
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    att = Attachment(id=att_id, name=path.name, size=path.stat().st_size, mime=mime, kind=kind, chars=len(text), note=note, session=session_id)
    if text:
        write_text(path.parent / "content.txt", text)
    write_json(path.parent / "meta.json", att.model_dump())
    return att


# ---------------- access ----------------

def _check_id(att_id: str) -> str:
    if not re.fullmatch(r"[a-f0-9]{12}", att_id):
        raise ValueError(tr("attachment.bad_id"))
    return att_id


def _folder(att: Attachment) -> Path:
    return (session_files_dir(att.session) if att.session else root()) / _check_id(att.id)


def _read(folder: Path) -> Attachment | None:
    meta = read_json(folder / "meta.json", default=None)
    return Attachment(**meta) if isinstance(meta, dict) else None


def get(att_id: str, session_id: str = "") -> Attachment | None:
    """An upload waiting for a session, or a file of the given session (another session's file is not found)."""
    _check_id(att_id)
    return _read(root() / att_id) or (_read(session_files_dir(session_id) / att_id) if session_id else None)


def find(att_id: str) -> Attachment | None:
    """Wherever it is (downloads from the chat history)."""
    _check_id(att_id)
    found = _read(root() / att_id)
    if found:
        return found
    sessions = paths().sessions
    hit = next(sessions.glob(f"ses_*/{SESSION_FILES}/{att_id}/meta.json"), None) if sessions.is_dir() else None
    return _read(hit.parent) if hit else None


def of_session(session_id: str) -> list[Attachment]:
    """Every file of the session, oldest first (the folder is the source of truth, like the diary)."""
    base = session_files_dir(session_id)
    if not base.is_dir():
        return []
    folders = sorted((d for d in base.iterdir() if (d / "meta.json").is_file()), key=lambda d: (d / "meta.json").stat().st_mtime)
    return [a for a in (_read(d) for d in folders) if a]


def adopt(att: Attachment, session_id: str) -> Attachment:
    """Move an upload into the session's folder (no-op for a file that is already there)."""
    if att.session:
        return att
    target = session_files_dir(session_id) / att.id
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(_folder(att)), str(target))
    moved = att.model_copy(update={"session": session_id})
    write_json(target / "meta.json", moved.model_dump())
    return moved


def file_path(att: Attachment) -> Path:
    return _folder(att) / att.name


def text(att: Attachment) -> str:
    return read_text(_folder(att) / "content.txt")


def image_bytes(att: Attachment) -> bytes:
    return file_path(att).read_bytes()


def remove(att: Attachment) -> None:
    shutil.rmtree(_folder(att), ignore_errors=True)


def cleanup_orphans() -> int:
    """Remove uploads that never reached a session (older than a day). Runs at startup."""
    removed = 0
    if not root().is_dir():
        return 0
    for d in root().iterdir():
        if d.is_dir() and time.time() - d.stat().st_mtime > ORPHAN_TTL:
            shutil.rmtree(d, ignore_errors=True)
            removed += 1
    return removed
