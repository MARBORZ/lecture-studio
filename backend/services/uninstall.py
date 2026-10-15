"""
Uninstall from the app: Settings → Interface → "Delete Lecture Studio".

  preview()        — what goes: the app folder (code, .venv, node_modules), the settings home (settings.json with API
                     keys, logs, launcher state, the app window profile) and, only when asked, the library. And whether
                     it can run: a library inside a folder that goes cannot be kept; git work that is not on GitHub
                     (a developer checkout) is never deleted from the app.
  start(delete_lessons) — writes the plan, copies the OS remover (launcher/*/remove.*) out of the app folder and starts it detached.
                     The caller then stops this server; the script waits for it to exit, closes what is left, deletes
                     the paths and the Desktop shortcut, and tells the user what was kept and how to install again.

Only known library items are deleted from data_dir (it may be a folder like ~/Documents), and nothing that contains
the home folder is ever deleted.
"""

import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from backend import config
from backend.models.system import UninstallPlan
from backend.settings.service import SettingsService
from backend.utils.fs import write_text

MAX_FILES = 40


class UninstallError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _inside(path: Path, folder: Path) -> bool:
    return path == folder or folder in path.parents


def _deletable(path: Path) -> bool:
    """Never the root, the home folder or anything that contains it; at least two levels below the root."""
    home = Path.home().resolve()
    return len(path.parts) > 2 and not _inside(home, path)


def _git(*args: str) -> str:
    res = subprocess.run(
        ["git", *args], cwd=config.REPO_DIR, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30
    )
    return res.stdout if res.returncode == 0 else ""


def _git_work() -> list[str]:
    """Changed or untracked files, unpushed commits and stashes: work that exists only in this folder."""
    if not (config.REPO_DIR / ".git").exists():
        return []
    files = [line[3:] for line in _git("status", "--porcelain").splitlines() if line.strip()]
    commits = [f"commit {line}" for line in _git("log", "--branches", "--not", "--remotes", "--oneline").splitlines() if line.strip()]
    stashes = [f"stash {line}" for line in _git("stash", "list").splitlines() if line.strip()]
    return files + commits + stashes


def _app_dirs() -> list[Path]:
    return [config.REPO_DIR.resolve(), config.APP_HOME.resolve()]


def preview() -> UninstallPlan:
    data = SettingsService.paths().data_dir.resolve()
    work = _git_work()
    return UninstallPlan(
        app_dir=str(config.REPO_DIR.resolve()),
        settings_dir=str(config.APP_HOME.resolve()),
        data_dir=str(data),
        lessons_inside=any(_inside(data, d) for d in _app_dirs()),
        blocked="git_work" if work else None,
        git_files=work[:MAX_FILES],
        reinstall="git" if (config.REPO_DIR / ".git").exists() else "setup",
        repo_url=config.REPO_URL,
    )


def _targets(plan: UninstallPlan, delete_lessons: bool) -> tuple[list[Path], list[Path]]:
    """(remove, remove_if_empty). Library items are listed one by one: data_dir itself goes only if nothing else is in it."""
    remove = list(_app_dirs())
    remove_if_empty: list[Path] = []
    if delete_lessons:
        p = SettingsService.paths()
        remove += [p.db, p.output, p.temp, p.diary, p.attachments, p.covers]
        remove_if_empty.append(p.data_dir)
    remove = [r.resolve() for r in remove]
    for r in [*remove, *remove_if_empty]:
        if not _deletable(r.resolve()):
            raise UninstallError("unsafe", f"Отказ: путь {r} нельзя удалять (корень диска или домашняя папка)")
    return remove, [r.resolve() for r in remove_if_empty]


def ui_english() -> bool:
    return SettingsService.get().ui_language == "en"


def _message(plan: UninstallPlan, delete_lessons: bool) -> str:
    """The script's last word: the app window is gone by then."""
    en = ui_english()
    if plan.reinstall == "git":
        again = (
            f"To install again: git clone {config.REPO_URL} \"{plan.app_dir}\", then run Setup in it."
            if en
            else f"Установить заново: git clone {config.REPO_URL} \"{plan.app_dir}\", затем запустите в ней Setup."
        )
    else:
        again = "To install again, run Lecture Studio Setup." if en else "Установить заново: запустите Lecture Studio Setup."
    if delete_lessons:
        kept = "Lessons were deleted too." if en else "Уроки тоже удалены."
    else:
        kept = f"Your lessons are kept: {plan.data_dir}" if en else f"Уроки сохранены: {plan.data_dir}"
    done = "Lecture Studio is deleted." if en else "Lecture Studio удалена."
    return f"{done} {kept} {again}"


def start(delete_lessons: bool) -> UninstallPlan:
    """Caller holds the system busy lock and stops the server right after."""
    plan = preview()
    if plan.blocked:
        raise UninstallError("git_work", "В папке приложения есть работа, которой нет на GitHub. Удалите папку вручную, если она не нужна.")
    if plan.lessons_inside and not delete_lessons:
        raise UninstallError("lessons_inside", "Уроки лежат внутри папки приложения. Перенесите их в Настройки → Пути или удалите вместе с приложением.")
    remove, remove_if_empty = _targets(plan, delete_lessons)

    work = Path(tempfile.mkdtemp(prefix="lecture-studio-uninstall-"))
    lines = [
        f"pid\t{os.getpid()}",
        f"ui_port\t{config.FRONTEND_PORT}",
        f"profile\t{config.CHROME_PROFILE_DIR}",
        f"message\t{_message(plan, delete_lessons)}",
        f"failed\t{'Could not delete:' if ui_english() else 'Не удалось удалить:'}",
    ]
    lines += [f"remove\t{p}" for p in remove] + [f"remove_if_empty\t{p}" for p in remove_if_empty]
    plan_file = work / "plan.tsv"
    write_text(plan_file, "\n".join(lines) + "\n")
    _spawn(work, plan_file)
    return plan


def _spawn(work: Path, plan_file: Path) -> None:
    """Run the uninstaller from a copy outside the app folder (the original is about to be deleted), detached."""
    common = {"cwd": work, "stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
    if sys.platform == "win32":
        src = config.REPO_DIR / "launcher" / "windows"
        for name in ("remove.ps1", "remove.vbs"):
            shutil.copy2(src / name, work / name)
        wscript = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "System32", "wscript.exe")
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
        subprocess.Popen([wscript, str(work / "remove.vbs"), str(plan_file)], creationflags=flags, **common)
    else:
        shutil.copy2(config.REPO_DIR / "launcher" / "macos" / "remove.zsh", work / "remove.zsh")
        subprocess.Popen(["/bin/zsh", str(work / "remove.zsh"), str(plan_file)], start_new_session=True, **common)
    time.sleep(0.2)  # let the child start before the server goes down
