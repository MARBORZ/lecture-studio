"""
The built UI (frontend/dist), served by this server next to /api: one process, no Node.js at run time.

  /assets/*        hashed bundles: cached for good (immutable); a missing one is 404, never index.html
  /favicon.svg …   other files of dist: revalidated (no-cache)
  anything else    index.html (no-cache), the React router takes the path; /api/* is never answered here

dist is looked up on every request: the launcher (re)builds it before the server starts, and a server without it
(development: Vite serves the UI) answers 404 with a hint.
"""

import mimetypes
from pathlib import Path

from starlette.requests import Request
from starlette.responses import FileResponse, PlainTextResponse, Response
from starlette.routing import Match, Route
from starlette.types import Scope

from backend import config

# Windows takes types from the registry, where .js is sometimes text/plain: a module script would not run.
for _type, _ext in (("text/javascript", ".js"), ("text/css", ".css"), ("image/svg+xml", ".svg"), ("font/woff2", ".woff2")):
    mimetypes.add_type(_type, _ext)

IMMUTABLE = "public, max-age=31536000, immutable"
REVALIDATE = "no-cache"


def _file(rel: str) -> Path | None:
    """A file inside dist, or None (also for any path that would leave it)."""
    root = config.FRONTEND_DIST.resolve()
    target = (root / rel).resolve()
    return target if target.is_relative_to(root) and target.is_file() else None


async def serve(request: Request) -> Response:
    rel = request.path_params["path"]
    found = _file(rel) if rel else None
    if found:
        immutable = rel.startswith("assets/")
        return FileResponse(found, headers={"Cache-Control": IMMUTABLE if immutable else REVALIDATE})
    if rel.startswith("assets/") or "." in rel.rsplit("/", 1)[-1]:
        return PlainTextResponse("Not Found", status_code=404)  # a file that is not there: no page in its place
    index = _file("index.html")
    if not index:
        return PlainTextResponse("The interface is not built: npm --prefix frontend run build", status_code=404)
    return FileResponse(index, headers={"Cache-Control": REVALIDATE})


class FrontendRoute(Route):
    """GET/HEAD of every path outside /api (so an unknown /api/… stays a JSON 404 from the API)."""

    def __init__(self) -> None:
        super().__init__("/{path:path}", serve, methods=["GET", "HEAD"], include_in_schema=False)

    def matches(self, scope: Scope) -> tuple[Match, Scope]:
        path = scope.get("path", "")
        if path == "/api" or path.startswith("/api/"):
            return Match.NONE, {}
        return super().matches(scope)
