from backend.core.ai.base import clean_output, split_lines


def test_clean_output_strips_emoji_and_fixes_timecodes():
    raw = "```markdown\n# 📘 Тема\n- ✅ пункт `[00:01:05]`\n- [59:00] мусор\n```"
    assert clean_output(raw, duration=600) == "# Тема\n- пункт [01:05]\n- мусор"


def test_split_lines_respects_limit():
    text = "\n".join(f"[00:{i:02d}] " + "x" * 50 for i in range(60))
    chunks = split_lines(text, limit=500)
    assert len(chunks) > 1 and all(len(c) <= 560 for c in chunks)
    assert "\n".join(chunks) == text
