"""
The app server as the launchers start it: one process listening on two ports.

    python -m backend.serve

  UI port (LS_UI_PORT, 5173)   the app window: the built UI + /api. The window's origin stays what it was when Vite
                               served it, so everything the UI keeps in localStorage (player positions, theme…) is kept.
  API port (LS_API_PORT, 3000) the same app: launchers, stop scripts, `npm run dev` (its proxy) talk to it here.

Development without the launcher: `uvicorn backend.main:app --port 3000` + `npm --prefix frontend run dev`.
"""

import uvicorn

from backend import config


def main() -> None:
    def cfg(port: int) -> uvicorn.Config:
        return uvicorn.Config("backend.main:app", host=config.HOST, port=port, timeout_graceful_shutdown=3)

    main_cfg = cfg(config.PORT)
    ports = dict.fromkeys([config.PORT, config.FRONTEND_PORT])  # one socket when both are set to the same port
    sockets = [cfg(port).bind_socket() for port in ports]  # a busy port exits here (startup failure)
    uvicorn.Server(main_cfg).run(sockets=sockets)


if __name__ == "__main__":
    main()
