"""
Project (= NotebookLM notebook) schemas.
"""

from datetime import datetime

from pydantic import BaseModel, Field

INBOX_ID = "proj_inbox"


class Project(BaseModel):
    id: str
    name: str
    description: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat(timespec="seconds"))
    lesson_count: int = 0
    cover: str = ""  # image file name in <data_dir>/covers ("" = none); changes with every new image


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
