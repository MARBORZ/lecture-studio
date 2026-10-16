"""
Hotkeys: the catalog of actions, their defaults and the rules a user's combination must pass.

A combination is a string: modifiers in a fixed order, then the physical key (KeyboardEvent.code, so it works in any
layout): "Mod+KeyB", "KeyF", "Ctrl+Mod+Digit5". "Mod" is the platform's command key (⌘ on macOS, Ctrl elsewhere);
"Ctrl" on a Mac is the Control key, "Meta" on Windows the Windows key. At most three keys in all.

The frontend (lib/hotkeys.ts) binds the actions by id and asks POST /api/settings/hotkeys/check while the user records
one, so the rules live only here. Overrides go to settings.json (hotkeys: {id: combo}); "" turns an action off.
"""

import re
import sys
from dataclasses import dataclass
from typing import Literal

HotkeyScope = Literal["global", "lesson", "player"]
HotkeyProblem = Literal["format", "too_many", "reserved", "conflict"]


@dataclass(frozen=True)
class Action:
    scope: HotkeyScope
    default: str


# The frontend keeps the same ids in lib/hotkeys.ts (tests/test_architecture.py compares them).
ACTIONS: dict[str, Action] = {
    "sidebar.toggle": Action("global", "Mod+KeyB"),
    "lesson.focus": Action("lesson", "KeyF"),
    "player.toggle": Action("player", "Space"),
    "player.back": Action("player", "ArrowLeft"),
    "player.forward": Action("player", "ArrowRight"),
    "player.mark": Action("player", "KeyM"),
}

# Which scopes are active at the same time: global everywhere; the lesson page also has the player.
_OVERLAP: dict[HotkeyScope, set[HotkeyScope]] = {
    "global": {"global", "lesson", "player"},
    "lesson": {"global", "lesson", "player"},
    "player": {"global", "lesson", "player"},
}

MODIFIERS = ("Mod", "Ctrl", "Meta", "Alt", "Shift")  # canonical order
MAX_KEYS = 3
_CODE = re.compile(
    r"Key[A-Z]|Digit[0-9]|F([1-9]|1[0-2])|Arrow(Up|Down|Left|Right)|Space|Enter|Escape|Tab|Backspace|Delete|Insert|"
    r"Home|End|PageUp|PageDown|Minus|Equal|Bracket(Left|Right)|Backslash|Semicolon|Quote|Comma|Period|Slash|Backquote|"
    r"Numpad[0-9A-Za-z]+"
)


def _is_mac(platform: str | None) -> bool:
    return (platform or sys.platform) == "darwin"


def parse(combo: str) -> tuple[frozenset[str], str] | None:
    """'Mod+Shift+KeyK' -> ({'Mod', 'Shift'}, 'KeyK'); None if it is not a valid combination string."""
    parts = combo.split("+")
    *mods, code = parts
    if not _CODE.fullmatch(code) or len(set(mods)) != len(mods) or any(m not in MODIFIERS for m in mods):
        return None
    return frozenset(mods), code


def normalize(combo: str) -> str | None:
    parsed = parse(combo)
    if not parsed:
        return None
    mods, code = parsed
    return "+".join([m for m in MODIFIERS if m in mods] + [code])


def _physical(mods: frozenset[str], platform: str | None) -> frozenset[str] | None:
    """Mod as the real key on this platform; None when the combination names that key twice (Mod+Meta on a Mac)."""
    real = "Meta" if _is_mac(platform) else "Ctrl"
    if "Mod" in mods and real in mods:
        return None
    return frozenset(real if m == "Mod" else m for m in mods)


# ---------------------------------------------------------------- reserved

_TEXT_KEYS = {"Tab", "Escape", "Enter", "Backspace", "Delete", "Home", "End", "PageUp", "PageDown"}
_BROWSER_F = {"F1", "F3", "F5", "F6", "F7", "F10", "F11", "F12"}
# Command-key combinations of the OS, the browser and text editing (⌘ on a Mac, Ctrl on Windows).
_CMD_LETTERS = set("ACVXZYQWRTNLPSFHMODGJUKE")
_CMD_CODES = {"Digit0", "Equal", "Minus", "Comma", "Backquote", "Space", "Period"}
_CMD_SHIFT = {"KeyZ", "KeyR", "KeyT", "KeyN", "KeyW", "KeyI", "KeyJ", "KeyC", "KeyA", "Delete"}
_MAC = {  # physical, macOS only
    frozenset({"Meta", "Shift"}): {"Digit3", "Digit4", "Digit5", "Digit6"},  # screenshots
    frozenset({"Ctrl", "Meta"}): {"KeyQ", "KeyF", "Space"},  # lock screen, full screen, emoji
    frozenset({"Meta", "Alt"}): {"KeyH", "KeyM", "KeyD", "KeyI", "KeyJ", "KeyC"},  # hide others, minimize all, dock, devtools
}


def reserved(combo: str, platform: str | None = None) -> bool:
    """Taken by the OS, the browser or text editing: never assignable."""
    parsed = parse(combo)
    if not parsed:
        return False
    mods, code = parsed
    phys = _physical(mods, platform)
    if phys is None:
        return True
    cmd = "Meta" if _is_mac(platform) else "Ctrl"
    if code in _TEXT_KEYS or code in _BROWSER_F:
        return True
    if not _is_mac(platform) and ("Meta" in phys or (phys == {"Alt"} and code in {"F4", "Space"})):
        return True  # the Windows key belongs to Windows; Alt+F4 closes, Alt+Space opens the window menu
    if code.startswith("Arrow") and phys:
        return True  # with any modifier: selection and word/line moves in text, desktops on a Mac
    if code == "Space" and phys and phys != {"Alt"}:
        return True  # Shift+Space scrolls up, Ctrl+Space switches the input language, ⌘Space is Spotlight
    if phys == {"Ctrl", "Shift"} and code == "KeyR":
        return True  # hard reload
    if phys == {cmd} and (code in _CMD_CODES or (code.startswith("Key") and code[3:] in _CMD_LETTERS)):
        return True
    if phys == {cmd, "Shift"} and (code in _CMD_SHIFT or code in {"Equal", "Minus"}):
        return True
    if phys == {cmd, "Alt"} and code in {"KeyI", "KeyJ", "KeyC"}:
        return True  # developer tools
    return _is_mac(platform) and code in _MAC.get(phys, set())


# ---------------------------------------------------------------- checks


@dataclass(frozen=True)
class Problem:
    code: HotkeyProblem
    action: str
    combo: str
    other: str = ""  # the action it conflicts with


def effective(overrides: dict[str, str]) -> dict[str, str]:
    """Every action -> its combination ("" = off): the user's override, else the default."""
    return {aid: overrides.get(aid, a.default) for aid, a in ACTIONS.items()}


def check(action: str, combo: str, overrides: dict[str, str], platform: str | None = None) -> Problem | None:
    """Can `action` take `combo` next to the other current combinations? "" (off) always can."""
    if action not in ACTIONS:
        return Problem("format", action, combo)
    if combo == "":
        return None
    norm = normalize(combo)
    if not norm:
        return Problem("format", action, combo)
    mods, _ = parse(norm)  # type: ignore[misc]
    if _physical(mods, platform) is None:
        return Problem("format", action, norm)  # the same key twice (Mod and Meta on a Mac, Mod and Ctrl elsewhere)
    if len(mods) + 1 > MAX_KEYS:
        return Problem("too_many", action, norm)
    if reserved(norm, platform):
        return Problem("reserved", action, norm)
    scope = ACTIONS[action].scope
    for other, other_combo in effective(overrides).items():
        if other != action and other_combo and normalize(other_combo) == norm and ACTIONS[other].scope in _OVERLAP[scope]:
            return Problem("conflict", action, norm, other)
    return None


def apply(overrides: dict[str, str], change: dict[str, str | None], platform: str | None = None) -> dict[str, str]:
    """New overrides after a patch ({id: combo | "" | None=default}); raises HotkeyError on the first problem.
    The whole result is checked, so swapping two actions in one patch works."""
    result = dict(overrides)
    for action, combo in change.items():
        if action not in ACTIONS:
            raise HotkeyError(Problem("format", action, combo or ""))
        if combo is None or normalize(combo) == ACTIONS[action].default:
            result.pop(action, None)
        else:
            result[action] = normalize(combo) or combo
    for action in change:
        combo = effective(result)[action]
        problem = check(action, combo, result, platform)
        if problem:
            raise HotkeyError(problem)
    return result


class HotkeyError(ValueError):
    def __init__(self, problem: Problem) -> None:
        super().__init__(f"{problem.code}: {problem.action} {problem.combo} {problem.other}".strip())
        self.problem = problem
