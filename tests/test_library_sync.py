"""
The app and the MCP server are two processes on one library: their writes never lose each other,
and a change made through MCP reaches the open app (Library.announce_change -> a `library` event on the job stream).
"""

import asyncio
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# one process: read-modify-write increments of a counter kept in the db
WRITER = """
import sys
from backend.services.storage import Library
for _ in range(int(sys.argv[1])):
    with Library.tx() as db:
        db["counter"] = db.get("counter", 0) + 1
"""


def test_two_processes_never_lose_a_write(data_dir):
    from backend.services.storage import Library

    n = 60
    writers = [subprocess.Popen([sys.executable, "-c", WRITER, str(n)], cwd=ROOT) for _ in range(2)]
    assert [w.wait(timeout=120) for w in writers] == [0, 0]
    assert Library.read()["counter"] == 2 * n


def test_mcp_changes_are_announced(data_dir):
    import mcp_server
    from backend.models.lesson import Lesson
    from backend.services.storage import Library

    Library.save_lesson(Lesson(id="less_m", job_id="m", title="Урок", clean_duration_sec=60))
    for call in (
        lambda: mcp_server.lecture_update_lesson("less_m", title="Новое"),
        lambda: mcp_server.lecture_save_audit_markdown("less_m", "## Тема\n- [00:10] мысль"),
        lambda: mcp_server.lecture_apply_agent_transcription("less_m", plain_text="текст"),
    ):
        before = Library.change_signal()
        call()
        assert Library.change_signal() != before
    before = Library.change_signal()
    mcp_server.lecture_update_lesson("less_missing", title="x")
    mcp_server.lecture_get_lesson_material("less_m")
    assert Library.change_signal() == before  # nothing changed, nothing announced


def test_job_stream_tells_the_app(data_dir):
    # the stream never ends, so its generator is driven directly (TestClient waits for the whole body)
    from backend.api.routes.jobs import stream_jobs
    from backend.services.storage import Library

    class Connected:
        async def is_disconnected(self):
            return False

    async def run():
        events = (await stream_jobs(Connected())).body_iterator
        try:
            first = await anext(events)
            Library.announce_change()
            return first, await anext(events)
        finally:
            await events.aclose()

    first, second = asyncio.run(run())
    assert first.startswith("data: [")  # the job list comes first
    assert second == f"event: library\ndata: {Library.change_signal()}\n\n"
