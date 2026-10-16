"""
Setup, Uninstall and the launchers speak the language of the OS: Russian on a Russian system, English everywhere else.
The macOS helper runs for real against a fake `defaults`; every Russian line of the scripts has its English twin.
"""

import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
ZSH = [ROOT / "setups" / "macos" / "install.zsh", ROOT / "launcher" / "macos" / "start.zsh", ROOT / "launcher" / "macos" / "stop.zsh"]
CYRILLIC = re.compile(r"[А-Яа-яЁё]")


def helper(script: Path) -> str:
    m = re.search(r"^os_lang\(\) \{\n.*?^L\(\) .*?\n", script.read_text("utf-8"), re.S | re.M)
    assert m, f"os_lang / L not found in {script}"
    return m.group(0)


def test_the_macos_helper_is_the_same_everywhere():
    assert len({helper(p) for p in ZSH}) == 1


@pytest.mark.skipif(sys.platform == "win32" or not shutil.which("zsh"), reason="zsh scripts")
@pytest.mark.parametrize(
    ("languages", "env", "expected"),
    [
        ('(\n    "ru-RU",\n    "en-US"\n)', "", "русский"),
        ("(\n    ru,\n    en\n)", "", "русский"),
        ('(\n    "en-US",\n    "ru-RU"\n)', "", "english"),  # Russian second: the system is not Russian
        ('(\n    "uk-UA"\n)', "", "english"),
        ("", "", "english"),  # defaults says nothing
        ('(\n    "en-US"\n)', "ru", "русский"),  # LECTURE_STUDIO_LANG wins
    ],
)
def test_macos_language_follows_the_first_preferred_language(tmp_path, languages, env, expected):
    fake = tmp_path / "defaults"
    fake.write_text(f"#!/bin/sh\ncat <<'OUT'\n{languages}\nOUT\n")
    fake.chmod(0o755)
    script = helper(ZSH[0]) + 'L "русский" "english"'
    res = subprocess.run(
        ["/bin/zsh", "-fuc", script], env={"PATH": f"{tmp_path}:/usr/bin:/bin", "LECTURE_STUDIO_LANG": env}, capture_output=True, text=True
    )
    assert res.stdout.strip() == expected, res.stderr


def test_every_russian_text_of_the_scripts_has_an_english_twin():
    # L "ru" "en" (zsh, PowerShell), my L("ru", "en") (AppleScript); comments may be Russian
    scripts = [*ZSH, *(ROOT / "setups" / "macos").glob("*.applescript"), *(ROOT / "setups" / "windows").glob("*.ps1")]
    scripts += [*(ROOT / "launcher" / "windows").glob("*.ps1"), *(ROOT / "launcher" / "windows").glob("*.vbs"), *(ROOT / "setups" / "windows").glob("*.cmd")]
    bad = []
    for p in scripts:
        for n, line in enumerate(p.read_text("utf-8-sig").splitlines(), 1):
            code = line.strip()
            if not CYRILLIC.search(code) or code.startswith(("#", "--", "'", "REM", "rem")):
                continue
            if not re.search(r"\bL[ (]", code):
                bad.append(f"{p.relative_to(ROOT)}:{n}")
    assert bad == []


def test_the_uninstall_tool_speaks_the_language_it_is_given(data_dir, monkeypatch):
    from backend import i18n

    monkeypatch.setattr(i18n, "lang", i18n.REAL_LANG)  # follow settings and the environment, not the test default
    assert i18n.tr("uninstall.done") == "Lecture Studio удалена."  # the interface language (ru by default)
    monkeypatch.setenv("LECTURE_STUDIO_LANG", "en")
    assert i18n.tr("uninstall.done") == "Lecture Studio is deleted."
    monkeypatch.setenv("LECTURE_STUDIO_LANG", "de")  # not ours: the interface language again
    assert i18n.tr("uninstall.done") == "Lecture Studio удалена."
