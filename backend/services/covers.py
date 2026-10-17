"""
Notebook cover images: <data_dir>/covers/<project_id>-<hash>.<ext>. The project keeps the file name (`Project.cover`),
so the name changes with every new image and the UI never shows a cached old one.
Only real images are accepted (checked by their first bytes, not by the extension).
"""

import hashlib
from pathlib import Path

from backend.i18n import tr
from backend.models.project import Project
from backend.services.storage import Projects
from backend.settings import paths

MAX_BYTES = 10 * 1024 * 1024
_SIGNATURES = {
    b"\x89PNG\r\n\x1a\n": ("png", "image/png"),
    b"\xff\xd8\xff": ("jpg", "image/jpeg"),
    b"GIF87a": ("gif", "image/gif"),
    b"GIF89a": ("gif", "image/gif"),
}
MIME = {"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"}


class CoverError(ValueError):
    pass


def _kind(data: bytes) -> str:
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    for sig, (ext, _) in _SIGNATURES.items():
        if data.startswith(sig):
            return ext
    raise CoverError(tr("cover.format"))


def remove_files(project_id: str) -> None:
    root = paths().covers
    if root.is_dir():
        for f in root.glob(f"{project_id}-*"):
            f.unlink(missing_ok=True)


def save(project_id: str, data: bytes) -> Project:
    if not Projects.get(project_id):
        raise LookupError(tr("project.not_found"))
    if not data:
        raise CoverError(tr("file.empty"))
    if len(data) > MAX_BYTES:
        raise CoverError(tr("cover.too_big"))
    name = f"{project_id}-{hashlib.sha1(data).hexdigest()[:10]}.{_kind(data)}"
    remove_files(project_id)
    paths().covers.mkdir(parents=True, exist_ok=True)
    (paths().covers / name).write_bytes(data)
    return Projects.set_cover(project_id, name)


def remove(project_id: str) -> Project:
    if not Projects.get(project_id):
        raise LookupError(tr("project.not_found"))
    remove_files(project_id)
    return Projects.set_cover(project_id, "")


def file_for(project_id: str) -> tuple[Path, str] | None:
    project = Projects.get(project_id)
    if not project or not project.cover:
        return None
    path = paths().covers / project.cover
    return (path, MIME.get(path.suffix.lstrip("."), "application/octet-stream")) if path.is_file() else None
