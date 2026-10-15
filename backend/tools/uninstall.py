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
from backend.models.system import UninstallPlan  # noqa: E402
from backend.services import uninstall  # noqa: E402

API = f"http://{config.HOST}:{config.PORT}"


def describe(plan: UninstallPlan) -> tuple[str, str]:
    en = uninstall.ui_english()
    if plan.blocked:
        work = "\n".join(plan.git_files[:10])
        text = (
            f"The app folder holds work that is not on GitHub:\n{work}\n\n"
            f"Lecture Studio does not delete such a folder: save the work or delete {plan.app_dir} by hand."
            if en
            else f"В папке программы есть работа, которой нет на GitHub:\n{work}\n\n"
            f"Lecture Studio не удаляет такую папку: сохраните работу или удалите {plan.app_dir} вручную."
        )
        return "blocked", text
    removes = (
        f"This will be removed:\n• the app and its dependencies: {plan.app_dir}\n• settings, API keys, logs: {plan.settings_dir}\n• the Desktop shortcut"
        if en
        else f"Будет удалено:\n• программа и зависимости: {plan.app_dir}\n• настройки, ключи API, логи: {plan.settings_dir}\n• ярлык на Рабочем столе"
    )
    if plan.lessons_inside:
        lessons = (
            f"Lessons are inside a folder that goes ({plan.data_dir}) and will be deleted with it. To keep them, cancel and move them in Settings → Paths."
            if en
            else f"Уроки лежат внутри удаляемой папки ({plan.data_dir}) и удалятся вместе с ней. "
            "Чтобы сохранить их, отмените и перенесите уроки в Настройки → Пути."
        )
        return "lessons_inside", f"{removes}\n\n{lessons}"
    lessons = f"Lessons: {plan.data_dir}" if en else f"Уроки: {plan.data_dir}"
    return "ok", f"{removes}\n\n{lessons}"


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
    en = uninstall.ui_english()
    here = str(config.REPO_DIR.resolve())
    running = _running_app_dir()
    if running is None:
        try:
            uninstall.start(delete_lessons)
        except uninstall.UninstallError as e:
            return str(e)
        return None
    if running != here:
        return (
            f"Another copy of Lecture Studio is running ({running or 'unknown folder'}). Shut it down, then try again."
            if en
            else f"Запущена другая копия Lecture Studio ({running or 'папка неизвестна'}). Выключите её и повторите."
        )
    status, body = _api("POST", "/api/system/uninstall", {"delete_lessons": delete_lessons})
    if status == 200:
        return None
    detail = body.get("detail") if isinstance(body.get("detail"), dict) else {}
    reasons = [r.get("label", "") for r in detail.get("reasons", [])]
    if reasons:
        busy = ", ".join(reasons)
        return f"Processing is running: {busy}. Wait for it to finish, then try again." if en else f"Идёт обработка: {busy}. Дождитесь окончания и повторите."
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
