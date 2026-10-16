"""Hotkey rules (settings/hotkeys.py) and their API: format, three keys, reserved, conflicts, reset."""

import pytest
from fastapi.testclient import TestClient

from backend.settings import hotkeys as h

PLATFORMS = ["darwin", "win32"]


@pytest.mark.parametrize("platform", PLATFORMS)
def test_defaults_pass_their_own_rules(platform):
    for action, a in h.ACTIONS.items():
        assert h.check(action, a.default, {}, platform) is None, action


@pytest.mark.parametrize(
    ("combo", "normal"),
    [("Shift+Mod+KeyK", "Mod+Shift+KeyK"), ("Alt+Ctrl+Digit5", "Ctrl+Alt+Digit5"), ("Space", "Space"), ("Mod+F2", "Mod+F2")],
)
def test_normalize_orders_modifiers(combo, normal):
    assert h.normalize(combo) == normal


@pytest.mark.parametrize("combo", ["", "Mod", "Mod+", "KeyK+Mod", "Mod+Mod+KeyK", "Super+KeyK", "Mod+k", "Mod+KeyKK", "Mod+Shift"])
def test_bad_strings_are_format_problems(combo):
    problem = h.check("player.mark", combo, {}, "darwin")
    assert (problem is None) if combo == "" else (problem and problem.code == "format")  # "" = off is fine


@pytest.mark.parametrize(("platform", "combo"), [("darwin", "Mod+Meta+KeyK"), ("win32", "Mod+Ctrl+KeyK")])
def test_the_same_key_twice_is_a_format_problem(platform, combo):
    assert h.check("player.mark", combo, {}, platform).code == "format"


def test_at_most_three_keys():
    assert h.check("player.mark", "Ctrl+Mod+Digit5", {}, "darwin") is None  # the user's example: ⌃⌘5
    assert h.check("player.mark", "Ctrl+Mod+Alt+Digit5", {}, "darwin").code == "too_many"


@pytest.mark.parametrize("platform", PLATFORMS)
@pytest.mark.parametrize(
    "combo",
    [
        "Mod+KeyQ", "Mod+KeyW", "Mod+KeyR", "Mod+Shift+KeyR", "Ctrl+Shift+KeyR", "Mod+KeyC", "Mod+KeyV", "Mod+KeyX",
        "Mod+KeyA", "Mod+KeyZ", "Mod+Shift+KeyZ", "Mod+KeyF", "Mod+KeyT", "Mod+KeyN", "Mod+KeyL", "Mod+KeyP", "Mod+Equal",
        "Mod+Minus", "Mod+Digit0", "F5", "Mod+F5", "F11", "F12", "Tab", "Shift+Tab", "Escape", "Enter", "Shift+Enter",
        "Mod+Enter", "Backspace", "Mod+Backspace", "Alt+Backspace", "Delete", "Shift+ArrowLeft", "Mod+ArrowRight",
        "Alt+ArrowLeft", "Mod+Shift+ArrowUp", "Home", "Shift+End", "Mod+Space", "Shift+Space", "Mod+Alt+KeyI",
    ],
)
def test_reserved_everywhere(platform, combo):
    problem = h.check("player.mark", combo, {}, platform)
    assert problem and problem.code == "reserved", (platform, combo)


@pytest.mark.parametrize("combo", ["Meta+Shift+Digit4", "Ctrl+Mod+KeyQ", "Ctrl+Mod+KeyF", "Ctrl+Mod+Space", "Mod+Alt+KeyH"])
def test_reserved_on_a_mac(combo):
    assert h.check("player.mark", combo, {}, "darwin").code == "reserved"


@pytest.mark.parametrize("combo", ["Meta+KeyK", "Meta+Digit1", "Alt+F4", "Alt+Space"])
def test_reserved_on_windows(combo):
    assert h.check("player.mark", combo, {}, "win32").code == "reserved"


@pytest.mark.parametrize("platform", PLATFORMS)
@pytest.mark.parametrize("combo", ["KeyK", "Shift+KeyK", "Mod+Digit1", "Mod+Shift+KeyK", "Alt+KeyK", "Digit5", "Period", "F2", "Mod+KeyB"])
def test_free_combinations(platform, combo):
    assert h.check("lesson.focus" if combo != "Mod+KeyB" else "sidebar.toggle", combo, {}, platform) is None


def test_conflicts_name_the_other_action():
    problem = h.check("player.mark", "KeyF", {}, "darwin")
    assert (problem.code, problem.other) == ("conflict", "lesson.focus")
    problem = h.check("lesson.focus", "Mod+KeyB", {}, "darwin")  # global is active on the lesson page too
    assert (problem.code, problem.other) == ("conflict", "sidebar.toggle")
    assert h.check("player.mark", "KeyF", {"lesson.focus": ""}, "darwin") is None  # turned off: free
    assert h.check("player.mark", "KeyM", {}, "darwin") is None  # its own combination


def test_apply_merges_resets_and_swaps():
    assert h.apply({}, {"player.mark": "KeyK"}, "darwin") == {"player.mark": "KeyK"}
    assert h.apply({"player.mark": "KeyK"}, {"player.mark": None}, "darwin") == {}  # back to the default
    assert h.apply({}, {"player.mark": "KeyM"}, "darwin") == {}  # the default itself is not stored
    swapped = h.apply({}, {"player.back": "ArrowRight", "player.forward": "ArrowLeft"}, "darwin")  # one patch
    assert swapped == {"player.back": "ArrowRight", "player.forward": "ArrowLeft"}
    with pytest.raises(h.HotkeyError) as e:
        h.apply({}, {"player.back": "ArrowRight"}, "darwin")
    assert (e.value.problem.code, e.value.problem.other) == ("conflict", "player.forward")
    with pytest.raises(h.HotkeyError):
        h.apply({}, {"no.such.action": "KeyK"}, "darwin")


# ---------------------------------------------------------------- API


@pytest.fixture()
def client(data_dir):
    from backend.main import app

    with TestClient(app, base_url="http://127.0.0.1") as c:
        yield c


def _bound(view) -> dict[str, str]:
    return {k["id"]: k["combo"] for k in view["hotkeys"]}


def test_settings_show_every_action_with_default_and_scope(client):
    keys = client.get("/api/settings").json()["hotkeys"]
    assert {k["id"] for k in keys} == set(h.ACTIONS)
    assert all(k["combo"] == k["default"] and k["scope"] in ("global", "lesson", "player") for k in keys)


def test_patch_saves_validates_and_resets(client):
    r = client.patch("/api/settings", json={"hotkeys": {"player.mark": "Shift+Mod+KeyK"}})
    assert r.status_code == 200 and _bound(r.json())["player.mark"] == "Mod+Shift+KeyK"

    r = client.patch("/api/settings", json={"hotkeys": {"lesson.focus": "Mod+Shift+KeyK"}})
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "conflict" and r.json()["detail"]["other"] == "player.mark"
    assert r.json()["detail"]["message"]  # in the interface language
    assert _bound(client.get("/api/settings").json())["lesson.focus"] == "KeyF"  # nothing saved

    assert client.patch("/api/settings", json={"hotkeys": {"player.toggle": "Mod+KeyQ"}}).json()["detail"]["code"] == "reserved"
    assert client.patch("/api/settings", json={"theme": "dark"}).status_code == 200  # other patches keep the hotkeys
    assert _bound(client.get("/api/settings").json())["player.mark"] == "Mod+Shift+KeyK"

    reset_all = {aid: None for aid in h.ACTIONS}
    view = client.patch("/api/settings", json={"hotkeys": reset_all}).json()
    assert all(k["combo"] == k["default"] for k in view["hotkeys"])


def test_check_endpoint(client):
    ok = client.post("/api/settings/hotkeys/check", json={"action": "player.mark", "combo": "Shift+KeyK"}).json()
    assert ok == {"ok": True, "combo": "Shift+KeyK", "problem": None, "other": ""}
    bad = client.post("/api/settings/hotkeys/check", json={"action": "player.mark", "combo": "Space"}).json()
    assert (bad["ok"], bad["problem"], bad["other"]) == (False, "conflict", "player.toggle")
    assert client.post("/api/settings/hotkeys/check", json={"action": "player.mark", "combo": "Mod+Alt+Shift+KeyK"}).json()["problem"] == "too_many"
