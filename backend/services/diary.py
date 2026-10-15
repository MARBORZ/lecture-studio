"""
Diary: a quick-capture stream of Markdown notes grouped into categories (= folders), Obsidian-compatible.
Files are the source of truth; there is no index to drift out of sync.
"""

import re
import shutil
import threading
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from backend.models.diary import DIARY_INBOX, DiaryCategory, DiaryEntry, DiaryEntryMeta
from backend.settings import paths
from backend.utils.fs import read_text, sanitize_filename, write_text

_STAMP = "%Y-%m-%d %H%M%S"
_lock = threading.RLock()


class DiaryError(ValueError):
    pass


def _root() -> Path:
    root = paths().data_dir / "diary"
    (root / DIARY_INBOX).mkdir(parents=True, exist_ok=True)
    return root


def _category_name(name: str) -> str:
    clean = re.sub(r"[\\/]+", " ", name).replace("..", " ")
    clean = re.sub(r"\s+", " ", sanitize_filename(clean, "")).strip(". ")
    if not clean:
        raise DiaryError("Пустое имя категории")
    return clean[:60]


def _category_dir(name: str, must_exist: bool = True) -> Path:
    d = _root() / _category_name(name)
    if must_exist and not d.is_dir():
        raise DiaryError(f"Категория не найдена: {name}")
    return d


def _entry_path(entry_id: str) -> Path:
    """Resolve an entry id safely inside the diary root."""
    root = _root().resolve()
    p = (root / entry_id).resolve()
    if root not in p.parents or p.suffix != ".md" or p.parent.parent != root:
        raise DiaryError("Некорректный идентификатор записи")
    if not p.is_file():
        raise FileNotFoundError("Запись не найдена")
    return p


def _title_and_excerpt(text: str) -> tuple[str, str]:
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    if not lines:
        return "Без названия", ""
    title = re.sub(r"^#+\s*", "", lines[0])[:90]
    excerpt = " ".join(lines[1:])[:220]
    return title, excerpt


def _created(p: Path) -> datetime:
    try:
        return datetime.strptime(p.stem[:17], _STAMP)
    except ValueError:
        return datetime.fromtimestamp(p.stat().st_mtime)


def _meta(p: Path, text: Optional[str] = None) -> DiaryEntryMeta:
    text = read_text(p) if text is None else text
    title, excerpt = _title_and_excerpt(text)
    return DiaryEntryMeta(
        id=f"{p.parent.name}/{p.name}",
        category=p.parent.name,
        title=title,
        excerpt=excerpt,
        created_at=_created(p).isoformat(timespec="seconds"),
        updated_at=datetime.fromtimestamp(p.stat().st_mtime).isoformat(timespec="seconds"),
    )


def _full(p: Path) -> DiaryEntry:
    text = read_text(p)
    return DiaryEntry(**_meta(p, text).model_dump(), text=text)


def _unique_file(directory: Path, stem: str) -> Path:
    candidate = directory / f"{stem}.md"
    n = 2
    while candidate.exists():
        candidate = directory / f"{stem}-{n}.md"
        n += 1
    return candidate


# ---------------- categories ----------------

def list_categories() -> List[DiaryCategory]:
    root = _root()
    cats = [DiaryCategory(name=d.name, count=sum(1 for _ in d.glob("*.md"))) for d in root.iterdir() if d.is_dir() and not d.name.startswith(".")]
    return sorted(cats, key=lambda c: (c.name != DIARY_INBOX, c.name.lower()))


def create_category(name: str) -> DiaryCategory:
    with _lock:
        d = _category_dir(name, must_exist=False)
        if d.exists():
            raise DiaryError("Такая категория уже есть")
        d.mkdir(parents=True)
        return DiaryCategory(name=d.name)


def rename_category(old: str, new: str) -> DiaryCategory:
    with _lock:
        src = _category_dir(old)
        if src.name == DIARY_INBOX:
            raise DiaryError("«Входящие» переименовать нельзя")
        dst = _category_dir(new, must_exist=False)
        if dst.exists():
            raise DiaryError("Такая категория уже есть")
        src.rename(dst)
        return DiaryCategory(name=dst.name, count=sum(1 for _ in dst.glob("*.md")))


def delete_category(name: str) -> int:
    """Entries are kept: they move to Inbox. Returns how many moved."""
    with _lock:
        src = _category_dir(name)
        if src.name == DIARY_INBOX:
            raise DiaryError("«Входящие» удалить нельзя")
        inbox = _root() / DIARY_INBOX
        moved = 0
        for f in src.glob("*.md"):
            shutil.move(str(f), str(_unique_file(inbox, f.stem)))
            moved += 1
        shutil.rmtree(src)
        return moved


# ---------------- entries ----------------

def list_entries(category: Optional[str] = None, query: Optional[str] = None) -> List[DiaryEntry]:
    dirs = [_category_dir(category)] if category else [d for d in _root().iterdir() if d.is_dir()]
    q = (query or "").strip().lower()
    out = []
    for d in dirs:
        for f in d.glob("*.md"):
            text = read_text(f)
            if q and q not in text.lower():
                continue
            out.append(DiaryEntry(**_meta(f, text).model_dump(), text=text))
    return sorted(out, key=lambda m: m.created_at, reverse=True)


def get_entry(entry_id: str) -> DiaryEntry:
    return _full(_entry_path(entry_id))


def create_entry(category: str, text: str) -> DiaryEntry:
    with _lock:
        d = _category_dir(category or DIARY_INBOX)
        p = _unique_file(d, datetime.now().strftime(_STAMP))
        write_text(p, text.rstrip() + "\n")
        return _full(p)


def update_entry(entry_id: str, text: Optional[str] = None, category: Optional[str] = None) -> DiaryEntry:
    with _lock:
        p = _entry_path(entry_id)
        if text is not None:
            write_text(p, text.rstrip() + "\n")
        if category and _category_name(category) != p.parent.name:
            target = _unique_file(_category_dir(category), p.stem)
            shutil.move(str(p), str(target))
            p = target
        return _full(p)


def delete_entry(entry_id: str) -> None:
    with _lock:
        _entry_path(entry_id).unlink()
