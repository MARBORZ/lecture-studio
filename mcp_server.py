"""
MCP server `lecture-studio`: gives AI agents (any MCP client) direct access
to the local lesson library. Thin layer over backend services — no file logic of its own.

All timecodes are on the CLEAN timeline (the one clean_video.mp4 / clean_speech.mp3 play on).
Every tool that changes the library ends with Library.announce_change(): the running app reloads what is open.
"""

import sys
from pathlib import Path
from typing import Any, Literal

sys.path.insert(0, str(Path(__file__).resolve().parent))

from mcp.server.mcpserver import MCPServer  # noqa: E402

from backend.core.ai.base import clean_output  # noqa: E402
from backend.core.timeline import TimeMap, parse_srt  # noqa: E402
from backend.core.transcription import write_transcripts  # noqa: E402
from backend.models.lesson import LessonPatch  # noqa: E402
from backend.models.project import INBOX_ID, Project  # noqa: E402
from backend.models.transcript import Segment  # noqa: E402
from backend.services.export import export_lesson  # noqa: E402
from backend.services.storage import Artifacts, Library  # noqa: E402
from backend.utils.fs import read_json, write_text  # noqa: E402

mcp = MCPServer("lecture-studio", instructions="Local lecture library. All timecodes are [MM:SS] on the clean timeline.")


def _not_found(lesson_id: str) -> dict[str, Any]:
    return {"error": f"Урок '{lesson_id}' не найден"}


def _named(project: Project) -> Project:
    """The Inbox keeps no name of its own (the app shows it in the interface language): agents get "Inbox"."""
    if project.id != INBOX_ID or project.name:
        return project
    return project.model_copy(update={"name": "Inbox", "description": project.description or "Lessons not sorted into a notebook"})


@mcp.tool()
def lecture_list_projects() -> list[dict[str, Any]]:
    """List notebooks (courses) with lesson counts. proj_inbox (Inbox) holds lessons not sorted into a notebook."""
    return [_named(p).model_dump() for p in Library.list_projects()]


@mcp.tool()
def lecture_list_lessons(project_id: str | None = None, status: str | None = None, search: str | None = None) -> list[dict[str, Any]]:
    """List lessons. status: in_progress | to_review | completed. search: title/notes/tags substring."""
    return [l.model_dump() for l in Library.list_lessons(project_id, status, search)]


# The same transcript in other forms: each about as large as clean_timestamps_text, all five together ~6x
# (a 20-minute lesson came to 129k characters, past what an agent takes in one tool result).
Extra = Literal["segments", "orig_timestamps_text", "srt_text", "plain_text", "time_map"]
EXTRAS: tuple[Extra, ...] = ("segments", "orig_timestamps_text", "srt_text", "plain_text", "time_map")


@mcp.tool()
def lecture_get_lesson_material(lesson_id: str, include: list[Extra] | None = None) -> dict[str, Any]:
    """
    Lesson package: metadata, lesson_audit_md and the transcript as clean_timestamps_text ([MM:SS] lines, clean
    timeline) — enough to read, quote and audit a lesson. The other forms of the same transcript are several times
    larger, so they come only when asked for in `include`: segments (clean+orig times per phrase),
    orig_timestamps_text, srt_text (clean SRT), plain_text, time_map.
    """
    lesson = Library.get_lesson_full(lesson_id)
    if not lesson:
        return _not_found(lesson_id)
    return lesson.model_dump(exclude=set(EXTRAS) - set(include or []))


def _track(lesson_id: str, kind: str, key: str) -> dict[str, Any]:
    lesson = Library.get_lesson(lesson_id)
    if not lesson:
        return _not_found(lesson_id)
    path = Library.media_file(lesson, kind)  # the lesson's copy, or the original recording (Eco)
    if path is None:
        return {"error": f"{kind} отсутствует у урока '{lesson_id}' (или исходный файл не найден по сохранённому пути)"}
    return {
        "lesson_id": lesson.id,
        "title": lesson.title,
        key: str(path),
        "clean_duration_sec": lesson.clean_duration_sec,
        "orig_duration_sec": lesson.orig_duration_sec,
        "saved_percent": lesson.saved_percent,
    }


@mcp.tool()
def lecture_get_clean_audio_track(lesson_id: str) -> dict[str, Any]:
    """Absolute path to clean_speech.mp3 (silence removed by Silero VAD) + durations."""
    return _track(lesson_id, "audio", "audio_path")


@mcp.tool()
def lecture_get_clean_video_track(lesson_id: str) -> dict[str, Any]:
    """Absolute path to clean_video.mp4 (jump-cut, H.264 CRF) + durations."""
    return _track(lesson_id, "video", "video_path")


@mcp.tool()
def lecture_search_transcripts(query: str, project_id: str | None = None) -> list[dict[str, Any]]:
    """Case-insensitive search across transcripts. Returns '[MM:SS] line' matches per lesson."""
    q = query.lower().strip()
    results = []
    for l in Library.list_lessons(project_id=project_id):
        full = Library.get_lesson_full(l.id)
        lines = (full.clean_timestamps_text if full else "").splitlines()
        matches = [line.strip() for line in lines if q in line.lower()]
        if matches:
            results.append({"lesson_id": l.id, "title": l.title, "project_id": l.project_id, "matches": matches[:15], "match_count": len(matches)})
    return results


@mcp.tool()
def lecture_save_audit_markdown(lesson_id: str, audit_markdown: str) -> dict[str, Any]:
    """Save/replace the lesson audit. Timecodes must be [MM:SS] on the clean timeline; out-of-range ones are dropped."""
    lesson = Library.get_lesson(lesson_id)
    if not lesson:
        return _not_found(lesson_id)
    path = write_text(Library.lesson_dir(lesson) / Artifacts.AUDIT, clean_output(audit_markdown, lesson.clean_duration_sec or None))
    Library.refresh_flags(lesson.id)
    Library.announce_change()
    return {"status": "ok", "file_path": str(path)}


@mcp.tool()
def lecture_update_lesson(
    lesson_id: str,
    title: str | None = None,
    project_id: str | None = None,
    notes: str | None = None,
    status: Literal["in_progress", "to_review", "completed"] | None = None,
    tags: str | None = None,
) -> dict[str, Any]:
    """Partial metadata update. Omitted fields are left unchanged."""
    lesson = Library.patch_lesson(lesson_id, LessonPatch(title=title, project_id=project_id, notes=notes, status=status, tags=tags))
    if not lesson:
        return _not_found(lesson_id)
    Library.announce_change()
    return {"status": "ok", "lesson": lesson.model_dump()}


@mcp.tool()
def lecture_export_to_local_folder(lesson_id: str, target_dir: str | None = None) -> dict[str, Any]:
    """Export to audio/ compressed/ content/ srt/ txt/ + <Title>.md. target_dir defaults to Settings → export folder."""
    try:
        return export_lesson(lesson_id, target_dir).model_dump()
    except Exception as e:
        return {"error": str(e)}


@mcp.tool()
def lecture_apply_agent_transcription(
    lesson_id: str,
    srt_content: str | None = None,
    srt_timeline: Literal["clean", "orig"] = "clean",
    plain_text: str | None = None,
    audit_markdown: str | None = None,
    target_export_folder: str | None = None,
) -> dict[str, Any]:
    """
    Apply an agent-made transcription and/or audit, then optionally export.
    srt_content is converted into segments.json and all transcript files are regenerated;
    srt_timeline says which timeline its times are on. plain_text is used only without SRT.
    """
    lesson = Library.get_lesson(lesson_id)
    if not lesson:
        return _not_found(lesson_id)
    d = Library.lesson_dir(lesson)
    tm = TimeMap(read_json(d / Artifacts.TIME_MAP, default=[]) or [])

    if srt_content:
        segs = []
        for item in parse_srt(srt_content):
            cs, ce = (item["start"], item["end"]) if srt_timeline == "clean" else (tm.orig_to_clean(item["start"]), tm.orig_to_clean(item["end"]))
            segs.append(Segment(clean_start=cs, clean_end=ce, orig_start=tm.clean_to_orig(cs), orig_end=tm.clean_to_orig(ce), text=item["text"]))
        write_transcripts(d, segs)
    elif plain_text:
        write_text(d / Artifacts.PLAIN, plain_text.strip() + "\n")

    if audit_markdown:
        write_text(d / Artifacts.AUDIT, clean_output(audit_markdown, lesson.clean_duration_sec or None))

    Library.refresh_flags(lesson.id)
    Library.announce_change()
    export = None
    if target_export_folder:
        try:
            export = export_lesson(lesson.id, target_export_folder).model_dump()
        except Exception as e:
            export = {"error": str(e)}
    return {"status": "ok", "lesson_id": lesson.id, "export": export}


if __name__ == "__main__":
    mcp.run()
