"""lecture_get_lesson_material: the audit and the [MM:SS] transcript by default; the larger forms only on request."""


def test_material_is_light_by_default_and_full_on_request(data_dir):
    import mcp_server
    from backend.models.lesson import Lesson
    from backend.services.storage import Lessons

    Lessons.save(Lesson(id="less_x", job_id="x", title="Урок", clean_duration_sec=60))
    srt = "1\n00:00:01,000 --> 00:00:03,000\nпервая фраза\n\n2\n00:00:04,000 --> 00:00:06,000\nвторая фраза\n"
    mcp_server.lecture_apply_agent_transcription("less_x", srt_content=srt)
    mcp_server.lecture_save_audit_markdown("less_x", "## Тема\n- [00:10] мысль")

    light = mcp_server.lecture_get_lesson_material("less_x")
    assert light["title"] == "Урок" and "мысль" in light["lesson_audit_md"]
    assert "фраза" in light["clean_timestamps_text"]
    assert not set(mcp_server.EXTRAS) & light.keys()

    full = mcp_server.lecture_get_lesson_material("less_x", include=["segments", "srt_text"])
    assert full["segments"] and "фраза" in full["srt_text"]
    assert "plain_text" not in full and "time_map" not in full

    assert "error" in mcp_server.lecture_get_lesson_material("less_missing")
