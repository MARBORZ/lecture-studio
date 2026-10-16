"""
Our own context window. The chat APIs are stateless: every question re-sends everything the model should know.
This module decides what one request carries and how much, within the provider's window. The user sets the window in
tokens per provider (Settings → AI, `AI.context_tokens`); the budget here counts characters, CHARS_PER_TOKEN each,
and keeps ANSWER_SHARE of the window free for the reply (a model's window holds the question and the answer):

    system prompt                         fixed
    session summary + recent messages     up to SHARE_HISTORY  — older turns are compressed into a summary
    files of this question                up to SHARE_FILES    — only the ones attached to it (they stay in the
                                                                 session's folder and can be attached again)
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

SHARE_HISTORY = 0.25
SHARE_FILES = 0.20
SUMMARY_SHARE = 0.06
KEEP_RECENT = 4
# compaction starts before the history reaches its share (so it never crowds out the material), keeping at least
# the last exchange; a long history is folded in chunks the model's window holds
COMPACT_AT = 0.9
MIN_KEEP = 2
CHUNK_SHARE = 0.5
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
    """The verbatim history is near its share of the window (COMPACT_AT) and there is something old to fold."""
    return len(recent(session)) > MIN_KEEP and history_chars(session) > window * SHARE_HISTORY * COMPACT_AT


def keep_for(session: ChatSession, window: int) -> int:
    """How many recent messages stay verbatim: KEEP_RECENT if they fit in half the history share, else fewer
    (never under MIN_KEEP): a few huge answers must not stop the compaction."""
    rec = recent(session)
    keep = min(KEEP_RECENT, len(rec))
    while keep > MIN_KEEP and sum(len(m.content) for m in rec[-keep:]) > window * SHARE_HISTORY / 2:
        keep -= 1
    return keep


def _as_text(messages: Sequence[ChatMessage]) -> str:
    lines = []
    for m in messages:
        lines.append(prompts.chat_line(m.role, m.content, [a.name for a in m.attachments]))
    return "\n\n".join(lines)


def compact(provider, session: ChatSession, window: int, keep: int | None = None) -> ChatSession:
    """Fold all but the last `keep` messages (plus the old summary) into a new summary. Returns the same session.
    However long the history, each call to the model carries at most CHUNK_SHARE of the window: the old messages are
    folded chunk by chunk, the summary of one going into the next — the compaction itself never overflows."""
    rec = recent(session)
    keep = keep_for(session, window) if keep is None else keep
    fold = len(rec) - keep
    if fold <= 0:
        return session
    limit = max(1500, int(window * SUMMARY_SHARE))
    room = max(4000, int(window * CHUNK_SHARE) - limit)
    summary, chunk, size = session.summary, [], 0
    for m in rec[:fold]:
        text = _as_text([m])[:room]  # one giant message: its beginning, rather than a request that cannot fit
        if chunk and size + len(text) > room:
            summary = _fold(provider, summary, chunk, limit)
            chunk, size = [], 0
        chunk.append(m.model_copy(update={"content": text}) if len(text) < len(m.content) else m)
        size += len(text)
    if chunk:
        summary = _fold(provider, summary, chunk, limit)
    session.summary = summary
    session.summarized += fold
    return session


def _fold(provider, summary: str, messages: Sequence[ChatMessage], limit: int) -> str:
    out = provider.generate_text(prompts.compact_prompt(summary, _as_text(messages), limit), system=prompts.compact_system())
    return out.strip()[: int(limit * 1.2)]


# ---------------------------------------------------------------- one request


@dataclass
class Request:
    messages: list[dict[str, str]]
    system: str
    images: list[tuple[bytes, str]] = field(default_factory=list)
    usage: ContextUsage | None = None


def _source_block(lesson: LessonFull, budget: int) -> tuple[str, bool, int]:
    """(the lesson's block cut to the budget, whether it was cut, the length of the whole block)."""
    transcript = compact_transcript(lesson.segments) or lesson.clean_timestamps_text or lesson.plain_text
    audit = lesson.lesson_audit_md
    head = prompts.source_head(lesson.id, lesson.title)
    audit_cut = audit[: budget // 3]
    audit_part = prompts.source_audit(audit_cut) if audit else ""
    rest = max(2000, budget - len(head) - len(audit_part))
    trimmed = len(audit_cut) < len(audit) or len(transcript) > rest
    whole = len(head) + (len(prompts.source_audit(audit)) if audit else 0) + len(prompts.source_transcript(transcript))
    return f"{head}{audit_part}{prompts.source_transcript(transcript[:rest])}", trimmed, whole


def _files_block(files: Sequence[Attachment], vision: bool, budget: int) -> tuple[str, list]:
    """Text of this question's files, read by id from disk. Images go to vision models as images."""
    if not files:
        return "", []
    parts, images = [], []
    per_file = max(2000, budget // len(files))
    for f in files:
        head = prompts.file_head(f.name, f.mime, f.size)
        if f.kind == "image":
            if vision:
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
    # the history never takes more than its share: the lesson material keeps its room (the oldest turns that do not
    # fit stay out of this request; the next compaction folds them into the summary)
    history = [{"role": m.role, "content": m.content} for m in recent(session)]
    cap = int(window * SHARE_HISTORY) - len(summary_block)
    while len(history) > MIN_KEEP and sum(len(h["content"]) for h in history) > cap:
        history = history[2:] if len(history) - 2 >= MIN_KEEP else history[1:]
    files_block, images = _files_block(new_files, vision, int(window * SHARE_FILES))
    final = prompts.CTX_QUESTION.format(files=files_block, question=question) if files_block else question

    used = len(system) + len(summary_block) + sum(len(h["content"]) for h in history) + len(final)
    per_source = max(MIN_SOURCE_CHARS, window - used) // max(1, len(sources))
    blocks = [_source_block(s, per_source) for s in sources]
    corpus = "\n\n".join(b for b, _, _ in blocks)
    whole = sum(w for _, _, w in blocks)

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
        sources_trimmed=any(t for _, t, _ in blocks),
        sources_count=len(sources),
        sources_whole=sum(1 for _, t, _ in blocks if not t),
        sources_share=min(1.0, len(corpus) / whole) if whole else 1.0,
    )
    usage.total = usage.system + usage.sources + usage.summary + usage.history + usage.files + len(question)
    usage.total_tokens = -(-usage.total // CHARS_PER_TOKEN)
    return Request(messages=messages, system=system, images=images, usage=usage)
