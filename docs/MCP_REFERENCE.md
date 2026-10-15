# MCP server `lecture-studio`

`mcp_server.py`, MCP Python SDK 2.x (`MCPServer`), stdio transport. A thin layer over `backend/services`:
no file logic of its own; data comes from the folder configured in settings.
All timecodes are on the clean timeline (they match clean_video.mp4 and clean_speech.mp3).

| Tool | Access | Purpose |
|---|---|---|
| `lecture_list_projects()` | read | notebooks with lesson counts |
| `lecture_list_lessons(project_id?, status?, search?)` | read | lessons; status: in_progress / to_review / completed |
| `lecture_get_lesson_material(lesson_id)` | read | audit, `segments`, `clean_timestamps_text`, `orig_timestamps_text`, `srt_text` (clean), `plain_text`, `time_map` |
| `lecture_get_clean_audio_track(lesson_id)` | read | absolute path to clean_speech.mp3 + durations |
| `lecture_get_clean_video_track(lesson_id)` | read | absolute path to clean_video.mp4 + durations |
| `lecture_search_transcripts(query, project_id?)` | read | matches as `[MM:SS] text` lines |
| `lecture_save_audit_markdown(lesson_id, audit_markdown)` | write | save an audit; timecodes are normalised, out-of-range ones dropped |
| `lecture_update_lesson(lesson_id, title?, project_id?, notes?, status?, tags?)` | write | partial update: omitted fields are unchanged |
| `lecture_export_to_local_folder(lesson_id, target_dir?)` | export | Obsidian layout; defaults to the export folder from settings |
| `lecture_apply_agent_transcription(lesson_id, srt_content?, srt_timeline="clean", plain_text?, audit_markdown?, target_export_folder?)` | write + export | bring your own transcript: SRT → `segments.json` → all txt/srt; `srt_timeline` says which timeline the SRT uses |

A lesson id may be given as `less_…` or as the `job_id`.
