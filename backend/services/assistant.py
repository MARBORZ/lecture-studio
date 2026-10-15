"""
NotebookLM-style assistant: answers grounded in selected lesson sources, with citations.

Threads:
  project:<id> — sources are lessons of the notebook (subset selectable), citations [[lesson_id@MM:SS]]
  lesson:<id>  — one source, citations [MM:SS]
"""

import re
import uuid
from typing import List, Optional

from backend.core.ai import AI
from backend.core.ai import prompts
from backend.core.ai.base import strip_emoji
from backend.core.timeline import normalize_timecodes
from backend.core.transcription import compact_transcript
from backend.models.assistant import AskRequest, ChatMessage, ThreadKind
from backend.models.lesson import LessonFull
from backend.services.storage import Library
from backend.settings import SettingsService

HISTORY_TURNS = 6

_CITE_RE = re.compile(r"\[\[([A-Za-z0-9_\-]+)@(\d{1,2}:\d{2}(?::\d{2})?)\]\]")


def _source_block(lesson: LessonFull, budget: int) -> str:
    transcript = compact_transcript(lesson.segments) or lesson.clean_timestamps_text or lesson.plain_text
    audit = lesson.lesson_audit_md
    head = f"### ИСТОЧНИК lesson_id={lesson.id} | {lesson.title}\n"
    audit_part = f"--- АУДИТ ---\n{audit[: budget // 3]}\n" if audit else ""
    rest = max(2000, budget - len(head) - len(audit_part))
    return f"{head}{audit_part}--- СТЕНОГРАММА ---\n{transcript[:rest]}\n"


def _resolve_sources(kind: ThreadKind, thread_id: str, requested: Optional[List[str]]) -> List[LessonFull]:
    if kind == "lesson":
        lesson = Library.get_lesson_full(thread_id)
        if not lesson:
            raise LookupError("Урок не найден")
        return [lesson]
    lessons = Library.list_lessons(project_id=thread_id)
    if requested is not None:
        wanted = set(requested)
        lessons = [l for l in lessons if l.id in wanted]
    full = [f for l in lessons if (f := Library.get_lesson_full(l.id)) and (f.segments or f.plain_text)]
    if not full:
        raise ValueError("Нет источников с текстом. Отметьте уроки со стенограммой.")
    return full


def _clean_citations(text: str, sources: List[LessonFull]) -> str:
    known = {s.id: s.clean_duration_sec for s in sources}

    def repl(m: re.Match) -> str:
        return m.group(0) if m.group(1) in known else ""

    return _CITE_RE.sub(repl, text)


def ask(kind: ThreadKind, thread_id: str, req: AskRequest) -> List[ChatMessage]:
    sources = _resolve_sources(kind, thread_id, req.sources)
    question = req.question.strip() or prompts.ROLE_DEFAULT_QUESTIONS.get(req.role, "")
    if not question:
        raise ValueError("Пустой вопрос")

    provider_name = req.provider or SettingsService.get().ai.assistant_provider
    provider = AI.get(provider_name)

    budget = provider.context_chars // len(sources)
    corpus = "\n\n".join(_source_block(s, budget) for s in sources)
    multi = kind == "project"

    history = Library.get_thread(kind, thread_id).messages[-HISTORY_TURNS * 2:]
    messages = [{"role": "user", "content": f"ИСТОЧНИКИ:\n\n{corpus}"}, {"role": "assistant", "content": "Источники приняты."}]
    messages += [{"role": m.role, "content": m.content} for m in history]
    messages.append({"role": "user", "content": question})

    answer = strip_emoji(provider.chat(messages, prompts.assistant_system(req.role, multi))).strip()
    if multi:
        answer = _clean_citations(answer, sources)
    else:
        answer = normalize_timecodes(answer, sources[0].clean_duration_sec or None)

    source_ids = [s.id for s in sources]
    user_msg = ChatMessage(id=uuid.uuid4().hex[:10], role="user", content=question, sources=source_ids, assistant_role=req.role)
    bot_msg = ChatMessage(
        id=uuid.uuid4().hex[:10], role="assistant", content=answer or "Пустой ответ",
        sources=source_ids, assistant_role=req.role, provider=provider_name, model=provider.model,
    )
    Library.append_messages(kind, thread_id, user_msg, bot_msg)
    return [user_msg, bot_msg]
