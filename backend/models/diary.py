"""
Diary schemas. Entries are plain Markdown files: <data_dir>/diary/<category>/<timestamp>.md (Obsidian-compatible).
"""


from pydantic import BaseModel, Field

DIARY_INBOX = "Входящие"


class DiaryCategory(BaseModel):
    name: str
    count: int = 0


class DiaryCategoryName(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class DiaryEntryMeta(BaseModel):
    id: str  # "<category>/<file>.md"
    category: str
    title: str
    excerpt: str
    created_at: str
    updated_at: str


class DiaryEntry(DiaryEntryMeta):
    text: str


class DiaryEntryCreate(BaseModel):
    category: str = DIARY_INBOX
    text: str = Field(min_length=1, max_length=200_000)


class DiaryEntryUpdate(BaseModel):
    text: str | None = Field(default=None, max_length=200_000)
    category: str | None = None
