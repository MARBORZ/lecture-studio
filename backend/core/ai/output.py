"""
What a model writes, made fit to keep: no emoji, no fence around the whole reply, timecodes in our format and within
the recording. Used for audits (core/ai/audit.py, Gemini's video audit), assistant answers and MCP writes.
"""

import re

from backend.core.timeline import normalize_timecodes

_EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF\U00002B00-\U00002BFF️‍]"
)


def strip_emoji(text: str) -> str:
    return re.sub(r"[ \t]{2,}", " ", _EMOJI_RE.sub("", text))


def clean_output(text: str, duration: float | None, timed: bool = True) -> str:
    text = strip_emoji(text).strip()
    text = re.sub(r"^```(?:markdown|md)?\s*\n(.*)\n```\s*$", r"\1", text, flags=re.S)  # unwrap fenced reply
    return normalize_timecodes(text, duration) if timed else text
