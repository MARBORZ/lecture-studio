"""
Diary: categories (folders) and quick-capture Markdown entries.
"""


from fastapi import APIRouter, HTTPException

from backend.models.diary import DiaryCategory, DiaryCategoryName, DiaryEntry, DiaryEntryCreate, DiaryEntryUpdate, DiaryPage
from backend.services import diary
from backend.services.diary import DiaryError

router = APIRouter(prefix="/api/diary", tags=["diary"])


def _guard(fn, *args):
    try:
        return fn(*args)
    except DiaryError as e:
        raise HTTPException(400, detail=str(e)) from e
    except FileNotFoundError as e:
        raise HTTPException(404, detail=str(e)) from e


@router.get("/categories", response_model=list[DiaryCategory])
def list_categories() -> list[DiaryCategory]:
    return diary.list_categories()


@router.post("/categories", response_model=DiaryCategory)
def create_category(req: DiaryCategoryName) -> DiaryCategory:
    return _guard(diary.create_category, req.name)


@router.patch("/categories/{name}", response_model=DiaryCategory)
def rename_category(name: str, req: DiaryCategoryName) -> DiaryCategory:
    return _guard(diary.rename_category, name, req.name)


@router.delete("/categories/{name}")
def delete_category(name: str) -> dict:
    return {"moved": _guard(diary.delete_category, name)}


@router.get("/entries", response_model=DiaryPage)
def list_entries(category: str | None = None, q: str | None = None, after: str | None = None, size: int = 30) -> DiaryPage:
    """Newest first, a page at a time (size up to 100; after = the previous page's next); q searches every entry before the cut."""
    return _guard(diary.page_entries, category, q, after, size)


@router.post("/entries", response_model=DiaryEntry)
def create_entry(req: DiaryEntryCreate) -> DiaryEntry:
    return _guard(diary.create_entry, req.category, req.text)


@router.get("/entries/{entry_id:path}", response_model=DiaryEntry)
def get_entry(entry_id: str) -> DiaryEntry:
    return _guard(diary.get_entry, entry_id)


@router.put("/entries/{entry_id:path}", response_model=DiaryEntry)
def update_entry(entry_id: str, req: DiaryEntryUpdate) -> DiaryEntry:
    return _guard(diary.update_entry, entry_id, req.text, req.category)


@router.delete("/entries/{entry_id:path}")
def delete_entry(entry_id: str) -> dict:
    _guard(diary.delete_entry, entry_id)
    return {"ok": True}
