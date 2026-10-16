"""
Project rules from CLAUDE.md, checked on every test run so the code keeps its shape.
Each rule says where something lives; a failure names the file that broke it.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
FRONT = ROOT / "frontend" / "src"
EMOJI = re.compile(r"[\U0001F300-\U0001FAFF☀-➿\U0001F000-\U0001F2FF]")


def files(base: Path, *patterns: str):
    for pattern in patterns:
        for p in base.rglob(pattern):
            if "node_modules" not in p.parts and p.name != "schema.d.ts":
                yield p


def offenders(base: Path, patterns, regex: str, allowed=()):
    rx = re.compile(regex, re.M)
    return sorted(str(p.relative_to(ROOT)) for p in files(base, *patterns) if rx.search(p.read_text("utf-8")) and str(p.relative_to(ROOT)) not in allowed)


def test_processes_only_through_proc_helpers():
    assert offenders(BACKEND, ["*.py"], r"^\s*(import|from) psutil", {"backend/utils/proc.py"}) == []


def test_prompt_text_only_in_prompts_module():
    # instruction text ("You are ...", "TASK:", "SOURCES:" framing) must not leak into providers or services
    assert offenders(BACKEND, ["*.py"], r"[\"']You are an? |TASK: |SOURCES:|QUESTION:", {"backend/core/ai/prompts.py"}) == []


def test_data_paths_come_from_settings():
    # every folder of the data dir is a Paths property; nothing else builds paths under it
    assert offenders(BACKEND, ["*.py"], r"data_dir\s*/\s*[\"']|[\"']notebook_db\.json[\"']", {"backend/settings/service.py"}) == []


def test_animation_only_through_motion_layer():
    allowed = {"frontend/src/components/motion/index.tsx", "frontend/src/lib/motion.ts"}
    assert offenders(FRONT, ["*.ts", "*.tsx"], r"from 'motion/react'", allowed) == []


def test_icons_render_through_icon_component():
    # lucide icons are passed around as values; only Icon renders one as an element
    bad = []
    for p in files(FRONT, "*.tsx"):
        src = p.read_text("utf-8")
        m = re.search(r"import \{([^}]*)\} from 'lucide-react'", src)
        names = [n.strip().split(" as ")[-1] for n in (m.group(1).split(",") if m else []) if n.strip() and not n.strip().startswith("type ")]
        if p.name != "Icon.tsx" and any(re.search(rf"<{n}[\s/>]", src) for n in names):
            bad.append(str(p.relative_to(ROOT)))
    assert bad == []


def test_hotkeys_match_physical_keys():
    # e.key is the typed character: with a Cyrillic layout Ctrl+B types "и" (Windows) and the hotkey never fires
    assert offenders(FRONT, ["*.ts", "*.tsx"], r"\.key(\.toLowerCase\(\))?\s*===\s*'[A-Za-zА-Яа-я]'") == []


def test_monochrome_palette_only_tokens():
    assert offenders(FRONT, ["*.tsx", "*.ts"], r"#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(") == []


def test_no_emoji_in_ui_or_backend():
    assert offenders(FRONT, ["*.ts", "*.tsx"], EMOJI.pattern) == []
    assert offenders(BACKEND, ["*.py"], EMOJI.pattern, {"backend/core/ai/base.py"}) == []  # base.py strips them


def test_strings_live_in_both_dictionaries():
    keys = [set(re.findall(r"^\s*'([\w.]+)':", (FRONT / "i18n" / f"{lang}.ts").read_text("utf-8"), re.M)) for lang in ("ru", "en")]
    assert keys[0] == keys[1], keys[0] ^ keys[1]


def test_api_types_are_generated_not_hand_written():
    # types.ts only aliases the generated schema
    src = (FRONT / "api" / "types.ts").read_text("utf-8")
    assert not re.search(r"^export (interface|type \w+ = \{)", src, re.M)


def test_subprocess_text_is_decoded_as_utf8():
    # text=True alone decodes with the OS locale: cp1252 on Windows turns "–" into "â€“" and Cyrillic into garbage
    bad = []
    for p in files(BACKEND, "*.py"):
        for call in re.findall(r"subprocess\.(?:run|Popen|check_output)\((?:[^()]|\([^()]*\))*\)", p.read_text("utf-8"), re.S):
            if re.search(r"\btext=True|universal_newlines=True", call) and "encoding=" not in call:
                bad.append(str(p.relative_to(ROOT)))
    assert bad == []
