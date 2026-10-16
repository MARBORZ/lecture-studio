"""
Projects (= notebooks).
"""


from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from backend.i18n import tr
from backend.models.project import INBOX_ID, Project, ProjectCreate, ProjectPatch
from backend.services import covers
from backend.services.storage import Library

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("", response_model=list[Project])
def list_projects() -> list[Project]:
    return Library.list_projects()


@router.post("", response_model=Project)
def create_project(data: ProjectCreate) -> Project:
    return Library.create_project(data)


@router.patch("/{project_id}", response_model=Project)
def patch_project(project_id: str, patch: ProjectPatch) -> Project:
    project = Library.patch_project(project_id, patch)
    if not project:
        raise HTTPException(404, detail=tr("project.not_found"))
    return project


@router.delete("/{project_id}")
def delete_project(project_id: str) -> dict:
    if project_id == INBOX_ID:
        raise HTTPException(400, detail=tr("project.inbox_delete"))
    if not Library.delete_project(project_id):
        raise HTTPException(404, detail=tr("project.not_found"))
    return {"ok": True}


@router.put("/{project_id}/cover", response_model=Project)
async def set_cover(project_id: str, request: Request) -> Project:
    """Body = the image bytes (PNG, JPEG, WebP, GIF; up to 10 MB)."""
    data = bytearray()
    async for chunk in request.stream():
        data += chunk
        if len(data) > covers.MAX_BYTES:
            raise HTTPException(413, detail=tr("cover.too_big"))
    try:
        return covers.save(project_id, bytes(data))
    except LookupError as e:
        raise HTTPException(404, detail=str(e)) from e
    except covers.CoverError as e:
        raise HTTPException(400, detail=str(e)) from e


@router.delete("/{project_id}/cover", response_model=Project)
def delete_cover(project_id: str) -> Project:
    try:
        return covers.remove(project_id)
    except LookupError as e:
        raise HTTPException(404, detail=str(e)) from e


@router.get("/{project_id}/cover")
def get_cover(project_id: str) -> FileResponse:
    found = covers.file_for(project_id)
    if not found:
        raise HTTPException(404, detail=tr("cover.none"))
    path, mime = found
    # the file name changes with the image, so the URL (?v=<name>) can be cached for good
    return FileResponse(path, media_type=mime, headers={"Cache-Control": "public, max-age=31536000, immutable"})
