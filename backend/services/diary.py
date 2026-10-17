"""
Diary: a quick-capture stream of Markdown notes grouped into categories (= folders), Obsidian-compatible.
Files are the source of truth; there is no index to drift out of sync.
"""

import re
import shutil
import threading
from datetime import datetime
from pathlib import Path

from backend.i18n import tr
from backend.models.diary import DIARY_INBOX, DiaryCategory, DiaryEntry, DiaryEntryMeta, DiaryPage
from backend.settings import paths
from backend.utils.fs import read_text, sanitize_filename, write_text

_STAMP = "%Y-%m-%d %H%M%S"
_lock = threading.RLock()


class DiaryError(ValueError):
    pass


def _root() -> Path:
    root = paths().diary
    (root / DIARY_INBOX).mkdir(parents=True, exist_ok=True)
    return root


def _category_name(name: str) -> str:
    clean = re.sub(r"[\\/]+", " ", name).replace("..", " ")
    clean = re.sub(r"\s+", " ", sanitize_filename(clean, "")).strip(". ")
    if not clean:
        raise DiaryError(tr("diary.empty_category"))
    return clean[:60]


def _category_dir(name: str, must_exist: bool = True) -> Path:
    d = _root() / _category_name(name)
    if must_exist and not d.is_dir():
        raise DiaryError(tr("diary.category_not_found", name=name))
    return d


def _entry_path(entry_id: str) -> Path:
    """Resolve an entry id safely inside the diary root."""
    root = _root().resolve()
    p = (root / entry_id).resolve()
    if root not in p.parents or p.suffix != ".md" or p.parent.parent != root:
        raise DiaryError(tr("diary.bad_id"))
    if not p.is_file():
        raise FileNotFoundError(tr("diary.entry_not_found"))
    return p


def _title_and_excerpt(text: str) -> tuple[str, str]:
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    if not lines:
        return tr("diary.untitled"), ""
    title = re.sub(r"^#+\s*", "", lines[0])[:90]
    excerpt = " ".join(lines[1:])[:220]
    return title, excerpt


def _created(p: Path) -> datetime:
    try:
        return datetime.strptime(p.stem[:17], _STAMP)
    except ValueError:
        return datetime.fromtimestamp(p.stat().st_mtime)


def _meta(p: Path, text: str | None = None) -> DiaryEntryMeta:
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

def list_categories() -> list[DiaryCategory]:
    root = _root()
    cats = [DiaryCategory(name=d.name, count=sum(1 for _ in d.glob("*.md"))) for d in root.iterdir() if d.is_dir() and not d.name.startswith(".")]
    return sorted(cats, key=lambda c: (c.name != DIARY_INBOX, c.name.lower()))


def create_category(name: str) -> DiaryCategory:
    with _lock:
        d = _category_dir(name, must_exist=False)
        if d.exists():
            raise DiaryError(tr("diary.category_exists"))
        d.mkdir(parents=True)
        return DiaryCategory(name=d.name)


def rename_category(old: str, new: str) -> DiaryCategory:
    with _lock:
        src = _category_dir(old)
        if src.name == DIARY_INBOX:
            raise DiaryError(tr("diary.inbox_rename", name=DIARY_INBOX))
        dst = _category_dir(new, must_exist=False)
        if dst.exists():
            raise DiaryError(tr("diary.category_exists"))
        src.rename(dst)
        return DiaryCategory(name=dst.name, count=sum(1 for _ in dst.glob("*.md")))


def delete_category(name: str) -> int:
    """Entries are kept: they move to Inbox. Returns how many moved."""
    with _lock:
        src = _category_dir(name)
        if src.name == DIARY_INBOX:
            raise DiaryError(tr("diary.inbox_delete", name=DIARY_INBOX))
        inbox = _root() / DIARY_INBOX
        moved = 0
        for f in src.glob("*.md"):
            shutil.move(str(f), str(_unique_file(inbox, f.stem)))
            moved += 1
        shutil.rmtree(src)
        return moved


# ---------------- entries ----------------

def list_entries(category: str | None = None, query: str | None = None) -> list[DiaryEntry]:
    dirs = [_category_dir(category)] if category else [d for d in _root().iterdir() if d.is_dir()]
    q = (query or "").strip().lower()
    out = []
    for d in dirs:
        for f in d.glob("*.md"):
            text = read_text(f)
            if q and q not in text.lower():
                continue
            out.append(DiaryEntry(**_meta(f, text).model_dump(), text=text))
    # the id (the file name) breaks ties within a second: the same order on every read, so pages never overlap
    return sorted(out, key=lambda m: (m.created_at, m.id), reverse=True)


PAGE_SIZE_MAX = 100


def _cursor(entry: DiaryEntry) -> str:
    return f"{entry.created_at}|{entry.id}"


def page_entries(category: str | None = None, query: str | None = None, after: str | None = None, size: int = 30) -> DiaryPage:
    """
    Entries a page at a time (the files are read and searched first: cheap, and the order and total stay exact).
    after = the previous page's `next`: the entries that come after that one in the order, so an entry written or
    deleted meanwhile neither repeats one nor skips one.
    """
    size = max(1, min(size, PAGE_SIZE_MAX))
    entries = list_entries(category, query)
    if after:
        created_at, _, entry_id = after.partition("|")
        entries_after = [e for e in entries if (e.created_at, e.id) < (created_at, entry_id)]
    else:
        entries_after = entries
    items = entries_after[:size]
    more = len(entries_after) > size
    return DiaryPage(items=items, total=len(entries), size=size, next=_cursor(items[-1]) if more else None)


def get_entry(entry_id: str) -> DiaryEntry:
    return _full(_entry_path(entry_id))


def create_entry(category: str, text: str) -> DiaryEntry:
    with _lock:
        d = _category_dir(category or DIARY_INBOX)
        p = _unique_file(d, datetime.now().strftime(_STAMP))
        write_text(p, text.rstrip() + "\n")
        return _full(p)


def update_entry(entry_id: str, text: str | None = None, category: str | None = None) -> DiaryEntry:
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
