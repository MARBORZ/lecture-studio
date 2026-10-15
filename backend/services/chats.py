"""
Assistant chat sessions, stored in notebook_db.json under threads["<kind>:<id>"]:

    {"active": "<session id>", "sessions": [ChatSession, ...]}

A thread (one lesson, one notebook) holds any number of sessions — branches like in Claude Code: a fresh session starts
with an empty history and its own files. Older databases kept a plain list of messages per thread; it is read as one
session and written back in the new shape on the next change.
"""

import re
import uuid
from collections.abc import Iterable
from datetime import datetime

from backend.models.assistant import Attachment, ChatMessage, ChatSession, SessionInfo, SessionPatch, ThreadKind
from backend.services import attachments
from backend.services.storage import Library

TITLE_MAX = 60


def _key(kind: ThreadKind, thread_id: str) -> str:
    return f"{kind}:{thread_id}"


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _normalize(raw) -> dict:
    """Stored value -> {"active", "sessions"}; a legacy list of messages becomes one session."""
    if isinstance(raw, dict) and isinstance(raw.get("sessions"), list):
        return raw
    if isinstance(raw, list) and raw:
        session = ChatSession(id=_new_id(), title=_title_from(raw), messages=[ChatMessage(**m) for m in raw])
        session.created_at = session.messages[0].created_at
        session.updated_at = session.messages[-1].created_at
        return {"active": session.id, "sessions": [session.model_dump()]}
    return {"active": None, "sessions": []}


def _new_id() -> str:
    return "ses_" + uuid.uuid4().hex[:8]


def _title_from(messages: list) -> str:
    for m in messages:
        role = m.role if isinstance(m, ChatMessage) else m.get("role")
        content = m.content if isinstance(m, ChatMessage) else m.get("content", "")
        if role == "user" and content.strip():
            line = " ".join(content.split())
            return line if len(line) <= TITLE_MAX else line[: TITLE_MAX - 1].rstrip() + "…"
    return ""


def session_files(session: ChatSession) -> list[Attachment]:
    """Every file attached in the session, oldest first, once."""
    seen: dict[str, Attachment] = {}
    for m in session.messages:
        for a in m.attachments:
            seen.setdefault(a.id, a)
    return list(seen.values())


def _info(s: ChatSession) -> SessionInfo:
    return SessionInfo(id=s.id, title=s.title, created_at=s.created_at, updated_at=s.updated_at, messages=len(s.messages))


# ---------------------------------------------------------------- reads


def load(kind: ThreadKind, thread_id: str) -> tuple[str | None, list[ChatSession]]:
    data = _normalize(Library.read()["threads"].get(_key(kind, thread_id)))
    return data["active"], [ChatSession(**s) for s in data["sessions"]]


def get(kind: ThreadKind, thread_id: str, session_id: str | None = None, create_missing: bool = False) -> tuple[ChatSession, list[SessionInfo]]:
    """The requested session (or the active one; an empty unsaved one if the thread has none) + the list, newest first.
    create_missing: an unknown id is a new session the UI showed before it was saved (first question goes into it)."""
    active, sessions = load(kind, thread_id)
    wanted = session_id or active
    current = next((s for s in sessions if s.id == wanted), None) or (sessions[-1] if sessions and not session_id else None)
    if session_id and current is None:
        if not create_missing or not re.fullmatch(r"ses_[0-9a-f]{8}", session_id):
            raise LookupError("Сессия не найдена")
        current = ChatSession(id=session_id)
    infos = sorted((_info(s) for s in sessions), key=lambda i: i.updated_at, reverse=True)
    return current or ChatSession(id=_new_id()), infos


# ---------------------------------------------------------------- writes


def _mutate(kind: ThreadKind, thread_id: str, fn) -> object:
    with Library.tx() as db:
        data = _normalize(db["threads"].get(_key(kind, thread_id)))
        sessions = [ChatSession(**s) for s in data["sessions"]]
        result = fn(data, sessions)
        data["sessions"] = [s.model_dump() for s in sessions]
        if data["sessions"]:
            db["threads"][_key(kind, thread_id)] = data
        else:
            db["threads"].pop(_key(kind, thread_id), None)
    return result


def create(kind: ThreadKind, thread_id: str) -> ChatSession:
    session = ChatSession(id=_new_id())

    def fn(data, sessions):
        # an untouched empty session is reused instead of piling up blanks
        blank = next((s for s in sessions if not s.messages), None)
        if blank:
            data["active"] = blank.id
            return blank
        sessions.append(session)
        data["active"] = session.id
        return session

    return _mutate(kind, thread_id, fn)


def activate(kind: ThreadKind, thread_id: str, session_id: str) -> None:
    def fn(data, sessions):
        if not any(s.id == session_id for s in sessions):
            raise LookupError("Сессия не найдена")
        data["active"] = session_id

    _mutate(kind, thread_id, fn)


def save(kind: ThreadKind, thread_id: str, session: ChatSession) -> ChatSession:
    """Insert or replace by id; it becomes the active session. The title comes from the first question."""
    session.updated_at = _now()
    if not session.title:
        session.title = _title_from(session.messages)

    def fn(data, sessions):
        idx = next((i for i, s in enumerate(sessions) if s.id == session.id), None)
        if idx is None:
            sessions.append(session)
        else:
            sessions[idx] = session
        data["active"] = session.id
        return session

    return _mutate(kind, thread_id, fn)


def patch(kind: ThreadKind, thread_id: str, session_id: str, change: SessionPatch) -> ChatSession:
    def fn(data, sessions):
        s = next((s for s in sessions if s.id == session_id), None)
        if not s:
            raise LookupError("Сессия не найдена")
        if change.title is not None:
            s.title = change.title.strip()
        if change.excluded_files is not None:
            known = {a.id for a in session_files(s)}
            s.excluded_files = [f for f in change.excluded_files if f in known]
        return s

    return _mutate(kind, thread_id, fn)


def clear(kind: ThreadKind, thread_id: str, session_id: str) -> ChatSession:
    """Empty one session: history, summary and its files (the whole context the model gets from it)."""

    def fn(data, sessions):
        s = next((s for s in sessions if s.id == session_id), None)
        if not s:
            raise LookupError("Сессия не найдена")
        dropped = [a.id for a in session_files(s)]
        s.messages, s.summary, s.summarized, s.excluded_files = [], "", 0, []
        s.updated_at = _now()
        return s, dropped

    session, dropped = _mutate(kind, thread_id, fn)
    attachments.delete(dropped)
    return session


def delete(kind: ThreadKind, thread_id: str, session_id: str) -> None:
    def fn(data, sessions):
        s = next((s for s in sessions if s.id == session_id), None)
        if not s:
            raise LookupError("Сессия не найдена")
        sessions.remove(s)
        if data["active"] == session_id:
            data["active"] = max(sessions, key=lambda x: x.updated_at).id if sessions else None
        return [a.id for a in session_files(s)]

    attachments.delete(_mutate(kind, thread_id, fn))


def delete_all(kind: ThreadKind, thread_id: str) -> None:
    with Library.tx() as db:
        raw = db["threads"].pop(_key(kind, thread_id), None)
    sessions = [ChatSession(**s) for s in _normalize(raw)["sessions"]]
    attachments.delete(a.id for s in sessions for a in session_files(s))


def referenced_attachments() -> Iterable[str]:
    for raw in Library.read()["threads"].values():
        for s in _normalize(raw)["sessions"]:
            for m in s.get("messages", []):
                for a in m.get("attachments", []):
                    yield a["id"]
