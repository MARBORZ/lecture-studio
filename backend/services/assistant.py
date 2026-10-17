"""
NotebookLM-style assistant: answers grounded in selected lesson sources, with citations.

Threads:
  project:<id> — sources are lessons of the notebook (subset selectable), citations [[lesson_id@MM:SS]]
  lesson:<id>  — one source, citations [MM:SS]
Each thread has sessions (services/chats.py); what one request carries is decided by services/context_window.py.

ask_events() streams an answer: a background thread asks the model and saves the answer to the session, the caller
only relays its pieces. A dropped connection (a reload, the page closed) stops the relay, not the answer.
"""

import logging
import queue
import re
import threading
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any

from backend.core.ai import AI, prompts
from backend.core.ai.output import strip_emoji
from backend.core.timeline import normalize_timecodes
from backend.i18n import tr
from backend.models.assistant import AskRequest, ChatMessage, Thread, ThreadKind
from backend.models.lesson import LessonFull
from backend.services import attachments as attachment_store
from backend.services import chats, context_window
from backend.services.storage import Lessons
from backend.settings import SettingsService

_CITE_RE = re.compile(r"\[\[([A-Za-z0-9_\-]+)@(\d{1,2}:\d{2}(?::\d{2})?)\]\]")

logger = logging.getLogger(__name__)


def _resolve_sources(kind: ThreadKind, thread_id: str, requested: list[str] | None) -> list[LessonFull]:
    if kind == "lesson":
        lesson = Lessons.get_full(thread_id)
        if not lesson:
            raise LookupError(tr("lesson.not_found"))
        return [lesson]
    lessons = Lessons.all(project_id=thread_id)
    if requested is not None:
        wanted = set(requested)
        lessons = [l for l in lessons if l.id in wanted]
    full = [f for l in lessons if (f := Lessons.get_full(l.id)) and (f.segments or f.plain_text)]
    if not full:
        raise ValueError(tr("assistant.no_sources"))
    return full


def _clean_citations(text: str, sources: list[LessonFull]) -> str:
    known = {s.id for s in sources}
    return _CITE_RE.sub(lambda m: m.group(0) if m.group(1) in known else "", text)


def _provider_name(requested: str | None) -> str:
    return requested or SettingsService.get().ai.assistant_provider


def thread(kind: ThreadKind, thread_id: str, session_id: str | None = None, provider: str | None = None, sources: list[str] | None = None) -> Thread:
    """The session with its files and the context the next question would carry (no API call, no key needed)."""
    session, infos = chats.get(kind, thread_id, session_id)
    name = _provider_name(provider)
    usage = None
    try:
        resolved = _resolve_sources(kind, thread_id, sources)
    except (LookupError, ValueError):
        resolved = []
    if resolved:
        window = context_window.window_for(name)
        usage = context_window.build(
            provider_name=name, window=window, vision=False, sources=resolved, session=session, multi=kind == "project",
            ui_language=SettingsService.get().ui_language,
        ).usage
    return Thread(kind=kind, id=thread_id, session=session, sessions=infos, files=chats.session_files(session), context=usage)


@dataclass
class _Question:
    kind: ThreadKind
    thread_id: str
    req: AskRequest
    sources: list[LessonFull]
    question: str
    name: str
    session: Any


def _prepare(kind: ThreadKind, thread_id: str, req: AskRequest) -> _Question:
    """Everything that can refuse the question before the model is asked (no sources, no key, empty question)."""
    sources = _resolve_sources(kind, thread_id, req.sources)
    question = req.question.strip() or prompts.default_question(req.role, SettingsService.get().ui_language)
    if not question:
        raise ValueError(tr("assistant.empty_question"))
    name = _provider_name(req.provider)
    AI.get(name)  # a missing key refuses here, not halfway
    session, _ = chats.get(kind, thread_id, req.session_id, create_missing=True)
    return _Question(kind, thread_id, req, sources, question, name, session)


def _answer(q: _Question, on_piece: Callable[[str], None]) -> Thread:
    """Ask the model (pieces go to on_piece as it writes), clean the answer, save both messages, return the thread."""
    req, session, sources, name = q.req, q.session, q.sources, q.name
    provider = AI.get(name)
    window = context_window.window_for(name)
    if context_window.needs_compaction(session, window):
        context_window.compact(provider, session, window)

    # this question's files: new uploads, or files of this session attached again (another session's are not found)
    new_files = [a for a in (attachment_store.get(i, session.id) for i in req.attachments) if a]
    multi = q.kind == "project"
    request = context_window.build(
        provider_name=name, window=window, vision=provider.can_see_images, sources=sources, session=session,
        role=req.role, multi=multi, question=q.question, new_files=new_files, ui_language=SettingsService.get().ui_language)
    pieces: list[str] = []
    for piece in provider.stream_chat(request.messages, request.system, images=request.images):
        pieces.append(piece)
        on_piece(piece)
    answer = strip_emoji("".join(pieces)).strip()
    answer = _clean_citations(answer, sources) if multi else normalize_timecodes(answer, sources[0].clean_duration_sec or None)

    source_ids = [s.id for s in sources]
    new_files = [attachment_store.adopt(a, session.id) for a in new_files]  # uploads join the session's folder
    session.messages += [
        ChatMessage(id=uuid.uuid4().hex[:10], role="user", content=q.question, sources=source_ids, attachments=new_files, assistant_role=req.role),
        ChatMessage(
            id=uuid.uuid4().hex[:10], role="assistant", content=answer or tr("assistant.empty_answer"),
            sources=source_ids, assistant_role=req.role, provider=name, model=provider.model,
        ),
    ]
    # past the line after this answer: fold now, so the next question (and the meter) start below it
    if context_window.needs_compaction(session, window):
        try:
            context_window.compact(provider, session, window)
        except Exception as e:  # the answer is what matters; the next question compacts again
            logger.warning("Compaction after the answer failed: %s", e)
    chats.save(q.kind, q.thread_id, session)
    return thread(q.kind, q.thread_id, session.id, name, req.sources)


def ask(kind: ThreadKind, thread_id: str, req: AskRequest) -> Thread:
    """The whole answer at once (no streaming)."""
    return _answer(_prepare(kind, thread_id, req), lambda piece: None)


def ask_events(kind: ThreadKind, thread_id: str, req: AskRequest) -> Iterator[dict[str, Any]]:
    """Refuses at once like ask(); then {"type": "delta", "text"} while the model writes, and one
    {"type": "done", "thread"} or {"type": "error", "detail"} at the end."""
    q = _prepare(kind, thread_id, req)
    events: queue.Queue[dict[str, Any]] = queue.Queue()

    def work() -> None:
        try:
            done = _answer(q, lambda piece: events.put({"type": "delta", "text": piece}))
            events.put({"type": "done", "thread": done.model_dump(mode="json")})
        except Exception as e:
            logger.warning("Assistant answer failed: %s", e, exc_info=True)
            events.put({"type": "error", "detail": tr("ai.error", error=e)})

    threading.Thread(target=work, name="assistant-answer", daemon=True).start()

    def relay() -> Iterator[dict[str, Any]]:
        while True:
            event = events.get()
            yield event
            if event["type"] != "delta":
                return

    return relay()


def compact(kind: ThreadKind, thread_id: str, session_id: str, provider: str | None = None, sources: list[str] | None = None) -> Thread:
    """Fold the session down to its last two messages now (the button), instead of waiting for the window to fill."""
    name = _provider_name(provider)
    p = AI.get(name)
    session, _ = chats.get(kind, thread_id, session_id)
    context_window.compact(p, session, context_window.window_for(name), keep=2)
    chats.save(kind, thread_id, session)
    return thread(kind, thread_id, session.id, name, sources)
