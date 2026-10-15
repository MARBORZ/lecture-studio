"""
Filesystem helpers. All os/path error handling lives here so business code stays linear.
"""

import json
import logging
import os
import re
import shutil
from pathlib import Path
from typing import Any, Optional, Union

logger = logging.getLogger(__name__)

PathLike = Union[str, Path]


def to_path(p: PathLike) -> Path:
    """Path with ~ expanded and surrounding quotes stripped (pasted Finder paths)."""
    if isinstance(p, str):
        p = Path(os.path.expanduser(p.strip().strip('"').strip("'")))
    return p.expanduser().resolve()


def ensure_dir(path: PathLike) -> Path:
    p = to_path(path)
    p.mkdir(parents=True, exist_ok=True)
    return p


def read_text(path: PathLike, default: str = "") -> str:
    p = to_path(path)
    if not p.is_file():
        return default
    try:
        return p.read_text(encoding="utf-8-sig")  # tolerate a BOM (files saved by Windows editors)
    except OSError as e:
        logger.warning("Cannot read %s: %s", p, e)
        return default


def write_text(path: PathLike, content: str) -> Path:
    """Atomic text write (tmp file + rename)."""
    p = to_path(path)
    ensure_dir(p.parent)
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(content, encoding="utf-8")
    tmp.replace(p)
    return p


def read_json(path: PathLike, default: Any = None) -> Any:
    p = to_path(path)
    if not p.is_file():
        return default
    try:
        return json.loads(p.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as e:
        logger.warning("Cannot parse JSON %s: %s", p, e)
        return default


def write_json(path: PathLike, data: Any) -> Path:
    return write_text(path, json.dumps(data, ensure_ascii=False, indent=2))


def remove_file(path: Optional[PathLike]) -> bool:
    if not path:
        return False
    p = to_path(path)
    try:
        if p.is_file():
            p.unlink()
            return True
    except OSError as e:
        logger.warning("Cannot remove %s: %s", p, e)
    return False


def remove_dir(path: PathLike) -> bool:
    p = to_path(path)
    if p.is_dir():
        shutil.rmtree(p, ignore_errors=True)
        return True
    return False


def clear_dir(path: PathLike) -> int:
    """Delete everything inside a directory, keep the directory itself. Returns freed bytes."""
    p = ensure_dir(path)
    freed = 0
    for item in p.iterdir():
        try:
            if item.is_dir():
                freed += sum(f.stat().st_size for f in item.rglob("*") if f.is_file())
                shutil.rmtree(item, ignore_errors=True)
            else:
                freed += item.stat().st_size
                item.unlink()
        except OSError as e:
            logger.warning("Cannot clear %s: %s", item, e)
    return freed


def copy_file(src: PathLike, dest: PathLike) -> Optional[Path]:
    """Copy if the source exists; returns destination or None."""
    src_p, dest_p = to_path(src), to_path(dest)
    if not src_p.is_file():
        return None
    ensure_dir(dest_p.parent)
    shutil.copy2(src_p, dest_p)
    return dest_p


def file_size_mb(path: PathLike) -> float:
    p = to_path(path)
    return round(p.stat().st_size / (1024 * 1024), 2) if p.is_file() else 0.0


def sanitize_filename(name: str, fallback: str = "item") -> str:
    clean = re.sub(r'[\\/*?:"<>|]', "_", name).strip()
    return clean or fallback
