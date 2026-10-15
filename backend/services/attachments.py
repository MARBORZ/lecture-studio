"""
Chat attachments: any file can be attached; readable formats are turned into text for the model.

  <data_dir>/attachments/<id>/<file>       the original file (downloadable from the chat)
  <data_dir>/attachments/<id>/meta.json    Attachment
  <data_dir>/attachments/<id>/content.txt  extracted text (when readable)

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
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional, Tuple

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


def root() -> Path:
    return paths().data_dir / "attachments"


def new_slot(filename: str) -> Tuple[str, Path]:
    """Reserve an id and a target path for an incoming upload."""
    att_id = uuid.uuid4().hex[:12]
    folder = root() / att_id
    folder.mkdir(parents=True, exist_ok=True)
    return att_id, folder / (sanitize_filename(Path(filename).name, "file") or "file")


# ---------------- extractors ----------------

def _decode(data: bytes) -> Optional[str]:
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


def _office(path: Path, members: Callable[[List[str]], Iterable[str]]) -> str:
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


EXTRACTORS: Dict[str, Callable[[Path], str]] = {
    ".pdf": extract_pdf,
    ".docx": lambda p: _office(p, lambda ns: [n for n in ns if n == "word/document.xml"]),
    ".pptx": lambda p: _office(p, lambda ns: sorted((n for n in ns if re.match(r"ppt/slides/slide\d+\.xml$", n)), key=_slide_no)),
    ".xlsx": lambda p: _office(p, lambda ns: [n for n in ns if n == "xl/sharedStrings.xml"]),
}


def _classify(path: Path) -> Tuple[str, str, str]:
    """-> (kind, extracted text, note)"""
    ext = path.suffix.lower() or ("." + path.name.lower() if path.name.startswith(".") else "")
    if ext in IMAGE_EXT:
        return "image", "", "Изображение: видит только Gemini"
    if ext in EXTRACTORS:
        try:
            return "document", EXTRACTORS[ext](path), ""
        except Exception as e:  # damaged or encrypted documents
            logger.warning("Extract failed for %s: %s", path.name, e)
            return "binary", "", "Не удалось прочитать документ"
    with open(path, "rb") as f:
        data = f.read(MAX_TEXT * 4)  # only the head: a multi-GB video must not be loaded to be classified
    text = _decode(data)
    if text is not None and (ext in TEXT_EXT or _mostly_printable(text)):
        return "text", text, ""
    return "binary", "", "Содержимое не читается: модели передаются имя и размер"


def _mostly_printable(text: str) -> bool:
    sample = text[:4000]
    return bool(sample) and sum(ch.isprintable() or ch in "\n\r\t" for ch in sample) / len(sample) > 0.95


def register(att_id: str, path: Path) -> Attachment:
    kind, text, note = _classify(path)
    if len(text) > MAX_TEXT:
        text, note = text[:MAX_TEXT], f"Текст обрезан до {MAX_TEXT // 1000}k символов"
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    att = Attachment(id=att_id, name=path.name, size=path.stat().st_size, mime=mime, kind=kind, chars=len(text), note=note)
    if text:
        write_text(path.parent / "content.txt", text)
    write_json(path.parent / "meta.json", att.model_dump())
    return att


# ---------------- access ----------------

def _folder(att_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{12}", att_id):
        raise ValueError("Некорректный идентификатор вложения")
    return root() / att_id


def get(att_id: str) -> Optional[Attachment]:
    meta = read_json(_folder(att_id) / "meta.json", default=None)
    return Attachment(**meta) if isinstance(meta, dict) else None


def file_path(att: Attachment) -> Path:
    return _folder(att.id) / att.name


def text(att: Attachment) -> str:
    return read_text(_folder(att.id) / "content.txt")


def image_bytes(att: Attachment) -> bytes:
    return file_path(att).read_bytes()


def delete(ids: Iterable[str]) -> None:
    for att_id in ids:
        try:
            shutil.rmtree(_folder(att_id), ignore_errors=True)
        except ValueError:
            pass


def cleanup_orphans(referenced: Iterable[str]) -> int:
    """Remove uploads that were never sent (older than a day). Runs at startup."""
    keep, removed = set(referenced), 0
    if not root().is_dir():
        return 0
    for d in root().iterdir():
        if d.is_dir() and d.name not in keep and time.time() - d.stat().st_mtime > ORPHAN_TTL:
            shutil.rmtree(d, ignore_errors=True)
            removed += 1
    return removed
