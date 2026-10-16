"""
Every prompt Lecture Studio sends to a model lives here. Providers never hold prompt text.

Two kinds of text:
  * editable blocks (BLOCKS) — role, style, structure, assistant tasks. The user can override any of them
    in Settings -> Instructions; untouched blocks use the defaults below (lessons, programming-friendly).
  * contract (TIMECODE_RULE, CITATION_*, chunk/merge mechanics) — fixed, because the UI parses it
    (clickable [MM:SS], [[lesson@MM:SS]] citations).

Default house style: slide-deck speaker notes. Blunt, architectural, no softening, no filler, no emoji.

Prompts are written in English (models follow English instructions most reliably); the OUTPUT language is a parameter:
an audit is written in the language chosen for it (the interface language by default, see core/language.py), the
assistant answers in the language of the question.
"""

from dataclasses import dataclass
from typing import Literal

from backend.settings import SettingsService

LANGUAGE_NAMES = {"ru": "Russian", "en": "English", "uk": "Ukrainian", "de": "German", "es": "Spanish", "fr": "French"}


def language_name(code: str) -> str:
    return LANGUAGE_NAMES.get(code, code or "the language of the lecture")


def _write_in(language: str) -> str:
    return (
        f"Write everything in {language_name(language)} — headings, bullets and terms' definitions — whatever the "
        "language of the transcript. Keep code, commands and proper names as they are."
    )


AUDIT_STYLE = """\
STYLE (mandatory; breaking it makes the audit worthless):
- Slide speaker notes: one bullet = one line, at most ~15 words.
- Facts, decisions, reasons, consequences only. Start a bullet with the point: a noun or a verb.
- Blunt and direct. No softening or hedging: no "it is worth noting", "it is important to understand", "one could say".
- No intros, no retelling the obvious, no praise for the lecturer, no moralising, no exclamations.
- No emoji or decorative symbols.
- When the lecturer is wrong, oversimplifies or contradicts themselves, say so plainly: "Wrong: …", "Simplification: …",
  "Contradiction: …" (in the output language).
- Fold the lecturer's repetitions into one bullet. Drop slips, noise and filler words.
- Terms as they are, not paraphrased into "simple words".
- Code, commands, paths and flags verbatim, in code blocks with the language.
"""

TIMECODE_RULE = """\
TIMECODES:
- Strictly [MM:SS] or [HH:MM:SS], in square brackets, no backticks.
- Take times only from the transcript lines. Do not invent or round beyond the line.
- A timecode goes at the start of a bullet or in a block heading.
"""

NO_TIMECODE_RULE = """\
TIMECODES: do not use any. No [MM:SS], no mentions of time.
"""

AUDIT_STRUCTURE_TIMED = """\
STRUCTURE (Markdown, exactly these sections, drop an empty section; headings in the output language):
# <Lesson topic — 3–8 words>
**Gist:** 1–2 lines — what is covered and why.

## Blocks
### [MM:SS] <Name of a meaningful block>
- point
- point

## Architecture and decisions
- [MM:SS] decision — why — cost/trade-off

## Code and commands
```language
verbatim
```
- [MM:SS] what it does, one line

## Mistakes and anti-patterns
- [MM:SS] mistake → how it should be

## Terms
| Term | Definition | Time |
|---|---|---|

## Takeaways
- 3–5 bullets: what to take from the lesson
"""

AUDIT_STRUCTURE_PLAIN = """\
STRUCTURE (Markdown, exactly these sections, drop an empty section; headings in the output language):
# <Lesson topic — 3–8 words>
**Gist:** 1–2 lines — what is covered and why.

## Blocks
### <Name of a meaningful block>
- point

## Architecture and decisions
- decision — why — cost/trade-off

## Code and commands
```language
verbatim
```

## Mistakes and anti-patterns
- mistake → how it should be

## Terms
| Term | Definition |
|---|---|

## Takeaways
- 3–5 bullets: what to take from the lesson
"""

ROLE_AUDITOR = (
    "You are a technical auditor of learning material. Your product is a hard-hitting audit of a lecture as slide "
    "speaker notes: read in a minute, understand the architecture, move on."
)

PART_NOTES = (
    "This is one part of a long lecture. Output only the notes of this part:\n{block}\n"
    "Plus separate lists, if any: code and commands, mistakes, terms. No lesson title and no takeaways."
)


def _part_task(timed: bool) -> str:
    return PART_NOTES.format(block="### [MM:SS] <block>\n- point" if timed else "### <block>\n- point")


def audit_system(timed: bool, language: str) -> str:
    return "\n\n".join([
        text("audit.role"),
        text("audit.style"),
        TIMECODE_RULE if timed else NO_TIMECODE_RULE,
        _structure(timed),
        _write_in(language),
        "Output only the audit Markdown, no preface.",
    ])


def audit_prompt(transcript: str, timed: bool) -> str:
    kind = "Transcript with timecodes of the clean recording" if timed else "Transcript"
    return f"{kind}. Write the audit following the structure.\n\n{transcript}"


# ---------- long lectures: chunk notes -> final merge ----------

def chunk_notes_system(timed: bool, language: str) -> str:
    return "\n\n".join([text("audit.role"), text("audit.style"), TIMECODE_RULE if timed else NO_TIMECODE_RULE, _part_task(timed), _write_in(language)])


def chunk_notes_prompt(transcript: str, part: int, total: int) -> str:
    return f"Part {part} of {total}.\n\n{transcript}"


def merge_system(timed: bool, language: str) -> str:
    return "\n\n".join([
        text("audit.role"),
        text("audit.style"),
        TIMECODE_RULE if timed else NO_TIMECODE_RULE,
        _structure(timed),
        _write_in(language),
        "The input is notes on the parts of one lecture. Assemble one audit following the structure. "
        "Keep every block and every timecode. Merge duplicates. Output only Markdown.",
    ])


# ---------- audit from video (Gemini watches an optimized copy) ----------

VIDEO_CONTEXT = """\
A video of the lecture is attached (one frame per second, reduced quality) on the same timeline as the transcript.
Use what is visible on screen: code, slides, diagrams, the terminal, actions in a UI. Copy code from the screen verbatim
when it is readable. Do not describe the video for its own sake — take from it only what adds to the audit.
"""

VIDEO_TIMECODE_RULE = """\
TIMECODES:
- Strictly [MM:SS] or [HH:MM:SS], in square brackets, no backticks.
- Time is the position in the video from its start. There is no transcript: rely on the speech and the frames.
"""


def video_audit_system(timed: bool, has_transcript: bool, part: bool, language: str) -> str:
    timing = (TIMECODE_RULE if has_transcript else VIDEO_TIMECODE_RULE) if timed else NO_TIMECODE_RULE
    task = _part_task(timed) if part else _structure(timed) + "\n\nOutput only the audit Markdown, no preface."
    return "\n\n".join([text("audit.role"), text("audit.style"), VIDEO_CONTEXT, timing, task, _write_in(language)])


def video_audit_prompt(transcript: str, part: int, total: int) -> str:
    head = f"Part {part} of {total} (the video is attached for this stretch only)." if total > 1 else "The lecture video is attached."
    body = f"Transcript of this stretch:\n\n{transcript}" if transcript.strip() else "No transcript — the video only."
    return f"{head} Write the audit.\n\n{body}"


# ---------- assistant (NotebookLM) ----------

ASSISTANT_BASE = """\
You are an assistant over the user's lecture library. Ground answers in the sources provided and cite them.
When the sources do not cover the question, or the user asks for general knowledge or your own view, say so in one
line and then answer from your own knowledge: put that part under a line "Beyond the lecture:" (in the language of the
answer), without timecodes or citations. Never attribute to the lecture what it does not say.
Style: slide speaker notes. Short, direct, no softening, no intros, no emoji.
"""

ASSISTANT_LANGUAGE = (
    "Answer in the language of the user's question. When the request is one of the quick actions (no question typed), "
    "answer in {language}."
)

CITATION_SINGLE = """\
CITATIONS: back every fact taken from the sources with a timecode [MM:SS] or [HH:MM:SS] from the transcript.
"""

CITATION_MULTI = """\
CITATIONS: back every fact taken from the sources with a reference [[<lesson_id>@MM:SS]] (or @HH:MM:SS), where lesson_id comes from the source
heading and the time from its transcript. Example: [[less_ab12cd34@04:15]].
"""

ROLE_TASKS: dict[str, str] = {
    "qa": "Answer the question. As a list if there are more than two points.",
    "key_moments": "Key moments: 8–15 bullets, each tied to a time.",
    "quiz": "Self-check quiz: 6 questions. Format: question → short correct answer → time reference.",
    "pitfalls": "Mistakes, anti-patterns, the lecturer's warnings. Format: mistake → how it should be → time.",
    "code_summary": "All code, commands, paths and flags verbatim in code blocks, in order, with times.",
    "chapters": "Chapters: 8–15 lines like \"[MM:SS] Title\", starting at [00:00].",
}

# Compressing the older part of a chat session (our own context window, services/context_window.py).
ASSISTANT_COMPACT = """\
Compress the start of a conversation between the user and the lecture assistant into a working summary to continue from.
Keep: what the user asked and why; the answers and conclusions; definitions and terms; decisions and corrections;
code, commands and paths verbatim; timecodes and source references as they are; what is still unclear, where it stopped.
Drop: repetitions, politeness, retellings of the sources that the materials already contain.
Style: notes, bullets, no intros, no emoji. Write it in the language of the conversation.
"""

COMPACT_CONTRACT = """\
Output only the summary. At most {limit} characters.
If a previous summary is given, merge it with the new messages into one, losing nothing important from it.
"""


def compact_system() -> str:
    return text("assistant.compact")


def compact_prompt(previous_summary: str, transcript: str, limit: int) -> str:
    parts = [COMPACT_CONTRACT.format(limit=limit)]
    if previous_summary.strip():
        parts.append(f"PREVIOUS SUMMARY:\n{previous_summary.strip()}")
    parts.append(f"NEW MESSAGES:\n{transcript}")
    return "\n\n".join(parts)


# ---------- assistant request framing (services/context_window.py assembles these) ----------

CTX_SOURCES = "SOURCES:\n\n{corpus}"
CTX_SOURCES_ACK = "Sources received."
CTX_SUMMARY = "SUMMARY OF THE START OF THIS SESSION:\n{summary}"
CTX_SUMMARY_ACK = "Summary received."
CTX_FILES = "SESSION FILES:\n\n{parts}"
CTX_QUESTION = "{files}\n\nQUESTION:\n{question}"
FILE_IMAGE_ATTACHED = "[image attached to the message]"
FILE_IMAGE_BLIND = "[image: this model cannot see images — say so if the question is about it]"
FILE_UNREADABLE = "[content not readable: only the name and size are available]"


def source_head(lesson_id: str, title: str) -> str:
    return f"### SOURCE lesson_id={lesson_id} | {title}\n"


def source_audit(audit: str) -> str:
    return f"--- AUDIT ---\n{audit}\n"


def source_transcript(transcript: str) -> str:
    return f"--- TRANSCRIPT ---\n{transcript}\n"


def file_head(name: str, mime: str, size: int) -> str:
    return f"### FILE: {name} ({mime}, {size} bytes)"


def chat_line(role: str, content: str, files: list[str]) -> str:
    """A message in the text the compactor reads."""
    who = "USER" if role == "user" else "ASSISTANT"
    attached = f" [files: {', '.join(files)}]" if files else ""
    return f"{who}{attached}:\n{content}"


# The question a quick-action button puts into the chat: the user reads it, so it is in the interface language.
ROLE_DEFAULT_QUESTIONS: dict[str, dict[str, str]] = {
    "ru": {
        "key_moments": "Выдели ключевые моменты.",
        "quiz": "Сделай тест самопроверки.",
        "pitfalls": "Собери ошибки и антипаттерны.",
        "code_summary": "Собери весь код и команды.",
        "chapters": "Сделай оглавление по главам.",
    },
    "en": {
        "key_moments": "Pick out the key moments.",
        "quiz": "Make a self-check quiz.",
        "pitfalls": "Collect the mistakes and anti-patterns.",
        "code_summary": "Collect all the code and commands.",
        "chapters": "Make chapters.",
    },
}


def default_question(role: str, ui_language: str) -> str:
    return ROLE_DEFAULT_QUESTIONS.get(ui_language, ROLE_DEFAULT_QUESTIONS["en"]).get(role, "")


# ---------- editable blocks ----------
# Titles and hints are shown in Settings -> Instructions; the UI translates them by key (i18n "prompts.<key>.*").

@dataclass(frozen=True)
class PromptBlock:
    key: str
    group: Literal["audit", "assistant"]
    default: str


BLOCKS: dict[str, PromptBlock] = {
    b.key: b
    for b in [
        PromptBlock("audit.role", "audit", ROLE_AUDITOR),
        PromptBlock("audit.style", "audit", AUDIT_STYLE),
        PromptBlock("audit.structure_timed", "audit", AUDIT_STRUCTURE_TIMED),
        PromptBlock("audit.structure_plain", "audit", AUDIT_STRUCTURE_PLAIN),
        PromptBlock("assistant.base", "assistant", ASSISTANT_BASE),
        PromptBlock("assistant.role.qa", "assistant", ROLE_TASKS["qa"]),
        PromptBlock("assistant.role.key_moments", "assistant", ROLE_TASKS["key_moments"]),
        PromptBlock("assistant.role.pitfalls", "assistant", ROLE_TASKS["pitfalls"]),
        PromptBlock("assistant.role.code_summary", "assistant", ROLE_TASKS["code_summary"]),
        PromptBlock("assistant.role.quiz", "assistant", ROLE_TASKS["quiz"]),
        PromptBlock("assistant.role.chapters", "assistant", ROLE_TASKS["chapters"]),
        PromptBlock("assistant.compact", "assistant", ASSISTANT_COMPACT),
    ]
}


def text(key: str) -> str:
    """Effective block text: the user's override from settings, else the default."""
    override = SettingsService.get().prompts.get(key, "")
    return override if override.strip() else BLOCKS[key].default


def _structure(timed: bool) -> str:
    return text("audit.structure_timed" if timed else "audit.structure_plain")


def assistant_system(role: str, multi_source: bool, ui_language: str = "en") -> str:
    task = text(f"assistant.role.{role}" if f"assistant.role.{role}" in BLOCKS else "assistant.role.qa")
    return "\n".join([
        text("assistant.base"),
        CITATION_MULTI if multi_source else CITATION_SINGLE,
        ASSISTANT_LANGUAGE.format(language=language_name(ui_language)),
        "TASK: " + task,
    ])


# ---------- Gemini transcription ----------

def gemini_transcription_instruction(language: str, vocabulary: str) -> str:
    lang = {"ru": "in Russian", "en": "in English"}.get(language, f"in {language}" if language and language != "auto" else "in the spoken language")
    vocab = f"\nSpell these terms exactly: {vocabulary.strip()}." if vocabulary.strip() else ""
    return (
        f"Transcribe the audio verbatim {lang}. Do not summarize. Punctuate. "
        "Split into natural phrases of 3–15 seconds. For each phrase return start_time_mm_ss, end_time_mm_ss, text."
        f"{vocab}"
    )
