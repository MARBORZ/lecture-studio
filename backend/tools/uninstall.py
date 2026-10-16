"""
Delete Lecture Studio from outside the app: Uninstall.app (macOS) and Uninstall.cmd (Windows) run this with the app's
own Python and only ask the questions. The rules are services/uninstall.py, the same as the button in Settings.

  python -m backend.tools.uninstall describe
      line 1: ok | lessons_inside | blocked; then the text for the dialog, in the UI language
  python -m backend.tools.uninstall run [--delete-lessons]
      through the running API when it is this install (it stops everything and refuses while busy), else directly.
      Exit 0: the remover is started and shows the final message. Exit 2: refused, the reason is on stderr.

A running server of another copy (another folder) is never touched: the user is asked to close it first.
"""

import argparse
import json
import logging
import sys
import urllib.error
import urllib.request

logging.disable(logging.CRITICAL)

from backend import config  # noqa: E402
from backend.i18n import tr  # noqa: E402
from backend.models.system import UninstallPlan  # noqa: E402
from backend.services import uninstall  # noqa: E402

API = f"http://{config.HOST}:{config.PORT}"


def describe(plan: UninstallPlan) -> tuple[str, str]:
    if plan.blocked:
        return "blocked", tr("uninstall.blocked", work="\n".join(plan.git_files[:10]), path=plan.app_dir)
    removes = tr("uninstall.removes", app=plan.app_dir, settings=plan.settings_dir)
    if plan.lessons_inside:
        return "lessons_inside", f"{removes}\n\n{tr('uninstall.lessons_inside_dialog', path=plan.data_dir)}"
    return "ok", f"{removes}\n\n{tr('uninstall.lessons_at', path=plan.data_dir)}"


def _api(method: str, path: str, body: dict | None = None, timeout: float = 5) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, json.load(res)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.load(e)
        except ValueError:
            return e.code, {}


def _running_app_dir() -> str | None:
    """The app folder of the server on our port, or None when nothing answers."""
    try:
        status, plan = _api("GET", "/api/system/uninstall", timeout=2)
    except (urllib.error.URLError, OSError, ValueError):
        return None
    return str(plan.get("app_dir")) if status == 200 else ""


def run(delete_lessons: bool) -> str | None:
    """None when started; otherwise the reason it was refused."""
    here = str(config.REPO_DIR.resolve())
    running = _running_app_dir()
    if running is None:
        try:
            uninstall.start(delete_lessons)
        except uninstall.UninstallError as e:
            return str(e)
        return None
    if running != here:
        return tr("uninstall.other_copy", path=running or tr("uninstall.unknown_folder"))
    status, body = _api("POST", "/api/system/uninstall", {"delete_lessons": delete_lessons})
    if status == 200:
        return None
    detail = body.get("detail") if isinstance(body.get("detail"), dict) else {}
    reasons = [r.get("label", "") for r in detail.get("reasons", [])]
    if reasons:
        return tr("uninstall.busy", reasons=", ".join(reasons))
    return str(detail.get("message") or body.get("detail") or f"HTTP {status}")


def main(argv: list[str] | None = None) -> int:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]  # Windows pipes default to the ANSI code page
    sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    parser = argparse.ArgumentParser(prog="python -m backend.tools.uninstall")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("describe")
    run_parser = sub.add_parser("run")
    run_parser.add_argument("--delete-lessons", action="store_true")
    args = parser.parse_args(argv)

    if args.command == "describe":
        state, text = describe(uninstall.preview())
        print(state)
        print(text)
        return 0
    reason = run(args.delete_lessons)
    if reason:
        print(reason, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
