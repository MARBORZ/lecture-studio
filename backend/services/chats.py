"""
Assistant chat sessions. Each session is a folder of its own, paths().sessions/<session id>/:

    context/session.json    everything written in the session (ChatSession) and the thread it belongs to
    local_session_src/      its files (services/attachments.py): kept from the moment they are added

notebook_db.json keeps only the index: threads["<kind>:<id>"] = {"active": "<session id>", "sessions": ["<id>", ...]}.
A thread (one lesson, one notebook) holds any number of sessions, branches of one conversation: a fresh session starts
with an empty history and no files. Older databases kept the sessions themselves in the index (or a plain list of
messages per thread): migrate() moves them out with their files at startup; reading tolerates the old shapes until then.
"""

import hashlib
import re
import shutil
import uuid
from datetime import datetime
from pathlib import Path

from backend.i18n import tr
from backend.models.assistant import Attachment, ChatMessage, ChatSession, SessionInfo, SessionPatch, ThreadKind
from backend.services import attachments
from backend.services.storage import LibraryDB
from backend.settings import paths
from backend.utils.fs import read_json, write_json

TITLE_MAX = 60


def _key(kind: ThreadKind, thread_id: str) -> str:
    return f"{kind}:{thread_id}"


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _new_id() -> str:
    return "ses_" + uuid.uuid4().hex[:8]


def _first_id(key: str) -> str:
    """The id of a thread's first, not yet saved session: the same on every read, so a file pasted before the first
    question lands in the folder of the session that question goes into."""
    return "ses_" + hashlib.sha256(key.encode()).hexdigest()[:8]


def _title_from(messages: list) -> str:
    for m in messages:
        role = m.role if isinstance(m, ChatMessage) else m.get("role")
        content = m.content if isinstance(m, ChatMessage) else m.get("content", "")
        if role == "user" and content.strip():
            line = " ".join(content.split())
            return line if len(line) <= TITLE_MAX else line[: TITLE_MAX - 1].rstrip() + "…"
    return ""


def _info(s: ChatSession) -> SessionInfo:
    return SessionInfo(id=s.id, title=s.title, created_at=s.created_at, updated_at=s.updated_at, messages=len(s.messages))


# ---------------------------------------------------------------- storage


def _folder(session_id: str) -> Path:
    if not re.fullmatch(r"ses_[0-9a-f]{8}", session_id):
        raise LookupError(tr("chat.session_not_found"))
    return paths().sessions / session_id


def _context_file(session_id: str) -> Path:
    return _folder(session_id) / "context" / "session.json"


def _read_session(session_id: str) -> ChatSession | None:
    raw = read_json(_context_file(session_id), default=None)
    return ChatSession(**raw) if isinstance(raw, dict) else None


def _write_session(key: str, session: ChatSession) -> None:
    write_json(_context_file(session.id), {"thread": key, **session.model_dump()})


def _sessions_of(raw) -> tuple[str | None, list[ChatSession], bool]:
    """Index value -> (active, sessions, legacy). Legacy: the sessions (or a list of messages) sit inside the index."""
    if isinstance(raw, list):
        if not raw:
            return None, [], False
        session = ChatSession(id=_new_id(), title=_title_from(raw), messages=[ChatMessage(**m) for m in raw])
        session.created_at = session.messages[0].created_at
        session.updated_at = session.messages[-1].created_at
        return session.id, [session], True
    if not isinstance(raw, dict):
        return None, [], False
    entries = raw.get("sessions") or []
    if any(isinstance(e, dict) for e in entries):
        return raw.get("active"), [ChatSession(**e) for e in entries if isinstance(e, dict)], True
    sessions = [s for s in (_read_session(e) for e in entries if isinstance(e, str)) if s]
    return raw.get("active"), sessions, False


def session_files(session: ChatSession) -> list[Attachment]:
    """Every file of the session (its folder), oldest first: what can be attached again."""
    return attachments.of_session(session.id)


# ---------------------------------------------------------------- reads


def load(kind: ThreadKind, thread_id: str) -> tuple[str | None, list[ChatSession]]:
    active, sessions, _ = _sessions_of(LibraryDB.read()["threads"].get(_key(kind, thread_id)))
    return active, sessions


def get(kind: ThreadKind, thread_id: str, session_id: str | None = None, create_missing: bool = False) -> tuple[ChatSession, list[SessionInfo]]:
    """The requested session (or the active one; an empty unsaved one if the thread has none) + the list, newest first.
    create_missing: an unknown id is a new session the UI showed before it was saved (first question goes into it)."""
    active, sessions = load(kind, thread_id)
    wanted = session_id or active
    current = next((s for s in sessions if s.id == wanted), None) or (sessions[-1] if sessions and not session_id else None)
    if session_id and current is None:
        if not create_missing or not re.fullmatch(r"ses_[0-9a-f]{8}", session_id):
            raise LookupError(tr("chat.session_not_found"))
        current = ChatSession(id=session_id)
    infos = sorted((_info(s) for s in sessions), key=lambda i: i.updated_at, reverse=True)
    return current or ChatSession(id=_first_id(_key(kind, thread_id))), infos


# ---------------------------------------------------------------- writes


def _mutate(kind: ThreadKind, thread_id: str, fn) -> object:
    """Read the thread, let fn change it, write every session's context and the index back. A session that is gone
    loses its folder (context and files)."""
    key = _key(kind, thread_id)
    with LibraryDB.tx() as db:
        active, sessions, _ = _sessions_of(db["threads"].get(key))
        before = {s.id for s in sessions}
        data = {"active": active}
        result = fn(data, sessions)
        for session in sessions:
            _write_session(key, session)
        if sessions:
            db["threads"][key] = {"active": data["active"], "sessions": [s.id for s in sessions]}
        else:
            db["threads"].pop(key, None)
    for gone in before - {s.id for s in sessions}:
        shutil.rmtree(_folder(gone), ignore_errors=True)
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
            raise LookupError(tr("chat.session_not_found"))
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
            raise LookupError(tr("chat.session_not_found"))
        if change.title is not None:
            s.title = change.title.strip()
        return s

    return _mutate(kind, thread_id, fn)


def clear(kind: ThreadKind, thread_id: str, session_id: str) -> ChatSession:
    """Empty one session: history, summary and its files (the whole context the model gets from it)."""

    def fn(data, sessions):
        s = next((s for s in sessions if s.id == session_id), None)
        if not s:
            raise LookupError(tr("chat.session_not_found"))
        s.messages, s.summary, s.summarized = [], "", 0
        s.updated_at = _now()
        return s

    session = _mutate(kind, thread_id, fn)
    shutil.rmtree(attachments.session_files_dir(session_id), ignore_errors=True)
    return session


def delete(kind: ThreadKind, thread_id: str, session_id: str) -> None:
    def fn(data, sessions):
        s = next((s for s in sessions if s.id == session_id), None)
        if not s:
            raise LookupError(tr("chat.session_not_found"))
        sessions.remove(s)
        if data["active"] == session_id:
            data["active"] = max(sessions, key=lambda x: x.updated_at).id if sessions else None

    _mutate(kind, thread_id, fn)


def delete_all(kind: ThreadKind, thread_id: str) -> None:
    _mutate(kind, thread_id, lambda data, sessions: sessions.clear())


def remove_file(session_id: str, att_id: str) -> None:
    """A file added to the session but never sent (its chip removed from the draft). Sent files stay with the history."""
    att = attachments.get(att_id, session_id)
    if not att:
        return
    session = _read_session(session_id)
    if session and any(a.id == att_id for m in session.messages for a in m.attachments):
        return
    attachments.remove(att)


# ---------------------------------------------------------------- migration


def migrate() -> int:
    """Move sessions kept inside notebook_db.json (and their files, from the shared uploads folder) into their own
    folders. Idempotent; returns how many threads moved."""
    if not any(_sessions_of(raw)[2] for raw in LibraryDB.read()["threads"].values()):
        return 0  # nothing to move: no write (a fresh library stays untouched)
    moved = 0
    with LibraryDB.tx() as db:
        for key, raw in list(db["threads"].items()):
            active, sessions, legacy = _sessions_of(raw)
            if not legacy:
                continue
            for session in sessions:
                for m in session.messages:
                    m.attachments = [_adopt_old(a, session.id) for a in m.attachments]
                _write_session(key, session)
            if sessions:
                db["threads"][key] = {"active": active or sessions[-1].id, "sessions": [s.id for s in sessions]}
            else:
                db["threads"].pop(key, None)
            moved += 1
    return moved


def _adopt_old(att: Attachment, session_id: str) -> Attachment:
    try:
        return attachments.adopt(att, session_id) if (attachments.root() / att.id).is_dir() else att
    except (OSError, ValueError):
        return att
