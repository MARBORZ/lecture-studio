"""
A raw streamed upload (the request body is the file) written to `dest`: one way for every route that takes a file.
Past `cap` bytes it stops with 413 `too_big`; an empty body is 400. Whatever stops it — the cap, a dropped
connection, the server shutting down mid-way — `discard()` removes what was written, so no half file stays behind.
"""

from collections.abc import Callable
from pathlib import Path

import aiofiles
from fastapi import HTTPException, Request

from backend.i18n import tr


async def receive(request: Request, dest: Path, discard: Callable[[], None], cap: int | None = None, too_big: str = "") -> int:
    """Write the body to dest; returns its size in bytes."""
    size = 0
    try:
        async with aiofiles.open(dest, "wb") as f:
            async for chunk in request.stream():
                size += len(chunk)
                if cap is not None and size > cap:
                    raise HTTPException(413, detail=too_big or tr("upload.too_big"))
                await f.write(chunk)
    except BaseException:  # CancelledError (shutdown) is not an Exception: it must clean up too
        discard()
        raise
    if size == 0:
        discard()
        raise HTTPException(400, detail=tr("file.empty"))
    return size
