"""
Projects (= notebooks).
"""

from typing import List

from fastapi import APIRouter, HTTPException

from backend.models.project import INBOX_ID, Project, ProjectCreate, ProjectPatch
from backend.services.storage import Library

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("", response_model=List[Project])
def list_projects() -> List[Project]:
    return Library.list_projects()


@router.post("", response_model=Project)
def create_project(data: ProjectCreate) -> Project:
    return Library.create_project(data)


@router.patch("/{project_id}", response_model=Project)
def patch_project(project_id: str, patch: ProjectPatch) -> Project:
    project = Library.patch_project(project_id, patch)
    if not project:
        raise HTTPException(404, detail="Блокнот не найден")
    return project


@router.delete("/{project_id}")
def delete_project(project_id: str) -> dict:
    if project_id == INBOX_ID:
        raise HTTPException(400, detail="Входящие удалить нельзя")
    if not Library.delete_project(project_id):
        raise HTTPException(404, detail="Блокнот не найден")
    return {"ok": True}
