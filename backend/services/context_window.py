"""
Our own context window. The chat APIs are stateless: every question re-sends everything the model should know.
This module decides what one request carries and how much, within the provider's window. The user sets the window in
tokens per provider (Settings → AI, `AI.context_tokens`); the budget here counts characters, CHARS_PER_TOKEN each,
and keeps ANSWER_SHARE of the window free for the reply (a model's window holds the question and the answer):

    system prompt                         fixed
    session summary + recent messages     up to SHARE_HISTORY  — older turns are compressed into a summary
    session files (text, by id from disk) up to SHARE_FILES    — attached once, sent with every question
    sources (audit + transcript)          everything that is left, split between the selected lessons
    the question                          as is

Compression ("medium"): when the verbatim history outgrows its share, everything except the last KEEP_RECENT messages
is folded into a summary of about SUMMARY_SHARE of the window by the model itself (prompt: assistant.compact).
The folded messages stay in the session for reading; only the summary is sent.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field

from backend.core.ai import AI, prompts
from backend.core.ai.base import CHARS_PER_TOKEN
from backend.core.transcription import compact_transcript
from backend.models.assistant import AssistantRole, Attachment, ChatMessage, ChatSession, ContextUsage
from backend.models.lesson import LessonFull
from backend.services import attachments as attachment_store
from backend.services.chats import session_files

SHARE_HISTORY = 0.25
SHARE_FILES = 0.20
SUMMARY_SHARE = 0.06
KEEP_RECENT = 4
MIN_SOURCE_CHARS = 4000
ANSWER_SHARE = 0.125


def window_for(provider_name: str) -> int:
    """What one request may carry, in characters: the window from the settings minus the room for the answer."""
    return int(AI.context_tokens(provider_name) * (1 - ANSWER_SHARE) * CHARS_PER_TOKEN)


def recent(session: ChatSession) -> list[ChatMessage]:
    return session.messages[session.summarized:]


def history_chars(session: ChatSession) -> int:
    return len(session.summary) + sum(len(m.content) for m in recent(session))


# ---------------------------------------------------------------- compression


def needs_compaction(session: ChatSession, window: int) -> bool:
    return len(recent(session)) > KEEP_RECENT and history_chars(session) > window * SHARE_HISTORY


def _as_text(messages: Sequence[ChatMessage]) -> str:
    lines = []
    for m in messages:
        lines.append(prompts.chat_line(m.role, m.content, [a.name for a in m.attachments]))
    return "\n\n".join(lines)


def compact(provider, session: ChatSession, window: int, keep: int = KEEP_RECENT) -> ChatSession:
    """Fold all but the last `keep` messages (plus the old summary) into a new summary. Returns the same session."""
    rec = recent(session)
    fold = len(rec) - keep
    if fold <= 0:
        return session
    limit = max(1500, int(window * SUMMARY_SHARE))
    summary = provider.generate_text(prompts.compact_prompt(session.summary, _as_text(rec[:fold]), limit), system=prompts.compact_system())
    session.summary = summary.strip()[: int(limit * 1.2)]
    session.summarized += fold
    return session


# ---------------------------------------------------------------- one request


@dataclass
class Request:
    messages: list[dict[str, str]]
    system: str
    images: list[tuple[bytes, str]] = field(default_factory=list)
    usage: ContextUsage | None = None


def _source_block(lesson: LessonFull, budget: int) -> tuple[str, bool]:
    transcript = compact_transcript(lesson.segments) or lesson.clean_timestamps_text or lesson.plain_text
    audit = lesson.lesson_audit_md
    head = prompts.source_head(lesson.id, lesson.title)
    audit_cut = audit[: budget // 3]
    audit_part = prompts.source_audit(audit_cut) if audit else ""
    rest = max(2000, budget - len(head) - len(audit_part))
    trimmed = len(audit_cut) < len(audit) or len(transcript) > rest
    return f"{head}{audit_part}{prompts.source_transcript(transcript[:rest])}", trimmed


def files_for(session: ChatSession, new: Sequence[Attachment]) -> list[Attachment]:
    """Session files that are switched on, then the ones attached to this question (once each)."""
    out: dict[str, Attachment] = {a.id: a for a in session_files(session) if a.id not in session.excluded_files}
    for a in new:
        out[a.id] = a
    return list(out.values())


def _files_block(files: Sequence[Attachment], new_ids: set, vision: bool, budget: int) -> tuple[str, list]:
    """Text of the files, read by id from disk (never re-uploaded). Images go to vision models only with the message
    they were attached to; later questions see the name."""
    if not files:
        return "", []
    parts, images = [], []
    per_file = max(2000, budget // len(files))
    for f in files:
        head = prompts.file_head(f.name, f.mime, f.size)
        if f.kind == "image":
            if f.id not in new_ids:
                parts.append(f"{head}\n{prompts.FILE_IMAGE_EARLIER}")
            elif vision:
                images.append((attachment_store.image_bytes(f), f.mime))
                parts.append(f"{head}\n{prompts.FILE_IMAGE_ATTACHED}")
            else:
                parts.append(f"{head}\n{prompts.FILE_IMAGE_BLIND}")
        elif f.chars:
            parts.append(f"{head}\n{attachment_store.text(f)[:per_file]}")
        else:
            parts.append(f"{head}\n{prompts.FILE_UNREADABLE}")
    return prompts.CTX_FILES.format(parts="\n\n".join(parts)), images


def build(
    *,
    provider_name: str,
    window: int,
    vision: bool,
    sources: Sequence[LessonFull],
    session: ChatSession,
    role: AssistantRole = "qa",
    multi: bool = False,
    question: str = "",
    new_files: Sequence[Attachment] = (),
    ui_language: str = "en",
) -> Request:
    system = prompts.assistant_system(role, multi, ui_language)
    summary_block = prompts.CTX_SUMMARY.format(summary=session.summary) if session.summary else ""
    history = [{"role": m.role, "content": m.content} for m in recent(session)]
    files_block, images = _files_block(files_for(session, new_files), {a.id for a in new_files}, vision, int(window * SHARE_FILES))
    final = prompts.CTX_QUESTION.format(files=files_block, question=question) if files_block else question

    used = len(system) + len(summary_block) + sum(len(h["content"]) for h in history) + len(final)
    per_source = max(MIN_SOURCE_CHARS, window - used) // max(1, len(sources))
    blocks = [_source_block(s, per_source) for s in sources]
    corpus = "\n\n".join(b for b, _ in blocks)

    messages = [{"role": "user", "content": prompts.CTX_SOURCES.format(corpus=corpus)}, {"role": "assistant", "content": prompts.CTX_SOURCES_ACK}]
    if summary_block:
        messages += [{"role": "user", "content": summary_block}, {"role": "assistant", "content": prompts.CTX_SUMMARY_ACK}]
    messages += history
    if question:
        messages.append({"role": "user", "content": final})

    usage = ContextUsage(
        provider=provider_name,
        window=window,
        window_tokens=AI.context_tokens(provider_name),
        chars_per_token=CHARS_PER_TOKEN,
        system=len(system),
        sources=len(corpus),
        summary=len(summary_block),
        history=sum(len(h["content"]) for h in history),
        files=len(files_block),
        summarized=session.summarized,
        sources_trimmed=any(t for _, t in blocks),
    )
    usage.total = usage.system + usage.sources + usage.summary + usage.history + usage.files + len(question)
    usage.total_tokens = -(-usage.total // CHARS_PER_TOKEN)
    return Request(messages=messages, system=system, images=images, usage=usage)
