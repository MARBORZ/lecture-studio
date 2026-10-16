"""
NotebookLM-style assistant: answers grounded in selected lesson sources, with citations.

Threads:
  project:<id> — sources are lessons of the notebook (subset selectable), citations [[lesson_id@MM:SS]]
  lesson:<id>  — one source, citations [MM:SS]
Each thread has sessions (services/chats.py); what one request carries is decided by services/context_window.py.
"""

import re
import uuid

from backend.core.ai import AI, prompts
from backend.core.ai.base import strip_emoji
from backend.core.timeline import normalize_timecodes
from backend.i18n import tr
from backend.models.assistant import AskRequest, ChatMessage, Thread, ThreadKind
from backend.models.lesson import LessonFull
from backend.services import attachments as attachment_store
from backend.services import chats, context_window
from backend.services.storage import Library
from backend.settings import SettingsService

_CITE_RE = re.compile(r"\[\[([A-Za-z0-9_\-]+)@(\d{1,2}:\d{2}(?::\d{2})?)\]\]")


def _resolve_sources(kind: ThreadKind, thread_id: str, requested: list[str] | None) -> list[LessonFull]:
    if kind == "lesson":
        lesson = Library.get_lesson_full(thread_id)
        if not lesson:
            raise LookupError(tr("lesson.not_found"))
        return [lesson]
    lessons = Library.list_lessons(project_id=thread_id)
    if requested is not None:
        wanted = set(requested)
        lessons = [l for l in lessons if l.id in wanted]
    full = [f for l in lessons if (f := Library.get_lesson_full(l.id)) and (f.segments or f.plain_text)]
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


def ask(kind: ThreadKind, thread_id: str, req: AskRequest) -> Thread:
    sources = _resolve_sources(kind, thread_id, req.sources)
    ui = SettingsService.get().ui_language
    question = req.question.strip() or prompts.default_question(req.role, ui)
    if not question:
        raise ValueError(tr("assistant.empty_question"))

    name = _provider_name(req.provider)
    provider = AI.get(name)
    window = context_window.window_for(name)
    session, _ = chats.get(kind, thread_id, req.session_id, create_missing=True)
    if context_window.needs_compaction(session, window):
        context_window.compact(provider, session, window)

    new_files = [a for a in (attachment_store.get(i) for i in req.attachments) if a]
    multi = kind == "project"
    request = context_window.build(
        provider_name=name, window=window, vision=provider.can_see_images, sources=sources, session=session,
        role=req.role, multi=multi, question=question, new_files=new_files, ui_language=SettingsService.get().ui_language)
    answer = strip_emoji(provider.chat(request.messages, request.system, images=request.images)).strip()
    answer = _clean_citations(answer, sources) if multi else normalize_timecodes(answer, sources[0].clean_duration_sec or None)

    source_ids = [s.id for s in sources]
    session.messages += [
        ChatMessage(id=uuid.uuid4().hex[:10], role="user", content=question, sources=source_ids, attachments=new_files, assistant_role=req.role),
        ChatMessage(
            id=uuid.uuid4().hex[:10], role="assistant", content=answer or tr("assistant.empty_answer"),
            sources=source_ids, assistant_role=req.role, provider=name, model=provider.model,
        ),
    ]
    chats.save(kind, thread_id, session)
    return thread(kind, thread_id, session.id, name, req.sources)


def compact(kind: ThreadKind, thread_id: str, session_id: str, provider: str | None = None, sources: list[str] | None = None) -> Thread:
    """Fold the session down to its last two messages now (the button), instead of waiting for the window to fill."""
    name = _provider_name(provider)
    p = AI.get(name)
    session, _ = chats.get(kind, thread_id, session_id)
    context_window.compact(p, session, context_window.window_for(name), keep=2)
    chats.save(kind, thread_id, session)
    return thread(kind, thread_id, session.id, name, sources)
