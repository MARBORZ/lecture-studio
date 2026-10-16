"""
Requests the API answers only from this computer.

- Host: only 127.0.0.1, localhost or [::1] (any port). A web page that rebinds its own domain to 127.0.0.1
  (DNS rebinding) still sends its domain as Host and gets 400 from TrustedHostMiddleware.
- Origin on writes (POST/PUT/PATCH/DELETE): a browser always names the page a request comes from. A write whose
  Origin is a page elsewhere (a website trying shutdown, update, uninstall, feedback…) gets 403. The UI's own
  pages are loopback (Vite on 5173, a second instance on another port, proxied); launchers, curl and the MCP
  server send no Origin and pass.
"""

import json
from urllib.parse import urlsplit

from starlette.types import ASGIApp, Receive, Scope, Send

LOCAL_HOSTS = ["127.0.0.1", "localhost", "[::1]"]
_UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


def local_origin(origin: str) -> bool:
    try:
        parts = urlsplit(origin)
        return parts.scheme in ("http", "https") and parts.hostname in ("127.0.0.1", "localhost", "::1")
    except ValueError:
        return False


class LocalOriginWrites:
    """403 for a write sent by a page that is not on this computer (no Origin: not a browser page, allowed)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] in _UNSAFE:
            origin = next((v.decode("latin-1") for k, v in scope["headers"] if k == b"origin"), None)
            if origin is not None and not local_origin(origin):
                body = json.dumps({"detail": "Requests from other sites are not allowed"}).encode()
                headers = [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]
                await send({"type": "http.response.start", "status": 403, "headers": headers})
                await send({"type": "http.response.body", "body": body})
                return
        await self.app(scope, receive, send)
