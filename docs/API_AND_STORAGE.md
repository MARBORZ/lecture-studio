# API and storage

API: `http://127.0.0.1:3000` (the UI reaches it through the Vite proxy at `:5173/api`). Schema: `/docs`, `/openapi.json`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | liveness |
| GET | `/api/system/status` | `busy` plus reasons (jobs, uploads, exports) |
| POST | `/api/system/shutdown` | shut down; `409` with reasons when busy. Stops the API, Vite and the app window |
| GET | `/api/system/update?force` | newest release tag vs the running version, changes, `blocked` reason, last update outcome (cached 1 h) |
| POST | `/api/system/update` | fast-forward to the release and restart through the launcher; `409` when busy or blocked |
| POST | `/api/system/update/discard` | put the modified tracked files (`dirty_files`, listed by the server, not the request) back to HEAD; returns a fresh check |
| GET | `/api/system/uninstall` | what "Delete Lecture Studio" removes (app folder, settings folder, data folder kept by default), `lessons_inside`, `blocked: git_work` with the files/commits, how to reinstall |
| POST | `/api/system/uninstall` | `{delete_lessons}`: start the OS uninstaller detached and stop everything; `409` when busy, when the library would go with the app folder, or on git work |
| GET / PATCH | `/api/settings` | settings (keys are masked, with their source: settings / env / none); `ai.context_tokens` is merged per provider (`null` = default), `422` outside the model's limits; `pipeline.output_language` (also in job options) is the audit language: `interface` (default) / `recording` / `ru` / `en`; `queue_limit` 1–100 |
| POST | `/api/settings/test-key` | test a key with one tiny model request |
| GET | `/api/settings/prompts` | AI instruction blocks: default, current, modified |
| PUT / DELETE | `/api/settings/prompts/{key}` | save a custom block text / reset to default |
| GET | `/api/settings/providers` | AI providers and models, context window limits in tokens (min, max, default) and `chars_per_token` |
| GET | `/api/settings/compute` | what local transcription runs on: `cuda` / `apple` / `cpu`, GPU name, threads, cores; on the CPU the reason (user, no_gpu, old_gpu, old_driver, torch_cpu, apple_unavailable, gpu_failed). The preference itself is `settings.compute` (`device`: auto/gpu/cpu, `cpu_threads`: 0 = all cores) |
| POST | `/api/settings/check-path` | check a folder (exists, writable, contains a library) |
| POST | `/api/settings/data-dir` | switch the data folder: `attach` or `move`; refused while busy |
| GET / POST | `/api/projects` | notebooks |
| PATCH / DELETE | `/api/projects/{id}` | rename / delete (lessons move to the inbox); the inbox's `name` / `description` are `""` until set (the UI shows them in its language) |
| GET | `/api/lessons?project_id&status&search` | lesson list |
| GET / PATCH / DELETE | `/api/lessons/{id}` | full lesson (with `speech_language`, `audit_language`) / partial update (`bookmarks` replaces the list of marks; `project_id` moves the lesson to another notebook, files stay where they are) / delete with files |
| GET | `/api/lessons/{id}/media/{audio,video}` | streaming with HTTP Range (instant seeking) |
| GET | `/api/lessons/{id}/files/{kind}` | download: audio, video, audit, srt, orig_srt, txt, clean_ts, orig_ts, segments, time_map |
| POST | `/api/lessons/{id}/export` | export to a folder (default: from settings) |
| POST | `/api/lessons/{id}/audit` | regenerate the audit `{provider, audit_mode, source: transcript\|video, language: interface\|recording\|ru\|en}` (background job) |
| POST | `/api/lessons/{id}/transcribe` | recognize speech again `{transcriber: whisper\|gemini}` from the lesson's audio (Eco: from the original); media is kept |
| POST | `/api/lessons/{id}/relink` | Eco: point the lesson at its recording's new path `{path}`; refused for another recording (length) |
| POST | `/api/lessons/{id}/drop-video` | delete the lesson's video, keep the sound (a user's own Eco file is never deleted) |
| POST | `/api/media/inspect` | a file on disk before processing: length, size, video or sound only, whether the browser plays it as is |
| PUT / DELETE / GET | `/api/projects/{id}/cover` | notebook cover: upload (body = image, PNG/JPEG/WebP/GIF ≤ 10 MB) / remove / the image |
| PUT | `/api/uploads/{filename}` | streamed upload into `temp/` (body = file bytes) |
| POST | `/api/jobs` | start: `{options, upload_id?}` or `options.local_path`; `400` at once for unreadable media or no sound track; `429` when the queue is full (`settings.queue_limit`, also for `/audit` and `/transcribe`) |
| GET | `/api/jobs`, `/api/jobs/{id}` | jobs |
| GET | `/api/jobs/stream` | SSE: the full job list on every change |
| POST | `/api/jobs/{id}/cancel` | cancel |
| GET | `/api/assistant/{project\|lesson}/{id}?session&provider&sources` | the session (active by default), the session list, session files, context usage for the next question |
| POST | `/api/assistant/{project\|lesson}/{id}` | ask `{question, role, attachments, session_id, provider, sources}` → the updated thread |
| DELETE | `/api/assistant/{project\|lesson}/{id}` | every session of the thread, with their files |
| POST | `/api/assistant/{kind}/{id}/sessions` | new session (an untouched empty one is reused) |
| PUT | `/api/assistant/{kind}/{id}/sessions/{sid}/active` | switch to a session |
| PATCH / DELETE | `/api/assistant/{kind}/{id}/sessions/{sid}` | rename `{title}` / delete with its folder (context and files) |
| POST | `/api/assistant/{kind}/{id}/sessions/{sid}/clear` | empty the session: history, summary, files |
| POST | `/api/assistant/{kind}/{id}/sessions/{sid}/compact` | fold the history into a summary now |
| PUT | `/api/assistant/attachments/{filename}?session` | upload a chat attachment, any type, up to 500 MB (body = file bytes), straight into the session's folder |
| DELETE | `/api/assistant/attachments/{id}?session` | a removed draft chip: deleted unless a sent message holds it |
| GET | `/api/assistant/attachments/{id}/file` | download an attachment |
| POST | `/api/feedback/drafts` | open a report: `{id, limits, retry_after}` (the server times the form from here) |
| PUT / DELETE | `/api/feedback/drafts/{id}/files/{filename}` | attach (body = file bytes; type, count and total size checked) / remove |
| DELETE | `/api/feedback/drafts/{id}` | throw the draft away |
| POST | `/api/feedback/drafts/{id}/send` | send `{kind, message, contact, diagnostics, website}` → `{status: sent\|queued, outbox}`; `429` + `Retry-After` on cooldown / daily limit; a filled honeypot or a too-fast form is dropped and answered as sent |
| GET / POST | `/api/diary/categories` | diary categories (folders) / create |
| PATCH / DELETE | `/api/diary/categories/{name}` | rename / delete (entries move to the inbox) |
| GET | `/api/diary/entries?category&q` | entries (full text), newest first, text search |
| POST | `/api/diary/entries` | new entry `{text, category}` |
| GET / PUT / DELETE | `/api/diary/entries/{category}/{file}.md` | entry / edit `{text?, category?}` (category change = move) / delete |

## Paths

| What | Where |
|---|---|
| `settings.json`, `server.pid`, `frontend.pid`, `logs/`, `state/`, `chrome-profile/` | settings home (`config.APP_HOME`) |
| `notebook_db.json` | `<data_dir>/` |
| Lessons | `<data_dir>/output/<job_id>/` |
| Diary | `<data_dir>/diary/<category>/*.md` |
| Notebook covers | `<data_dir>/covers/<project_id>-<hash>.<ext>` (`Project.cover` = file name) |
| Assistant sessions | `<data_dir>/sessions/<id>/context/session.json` and `local_session_src/<file id>/` (original file, `content.txt`, `meta.json`) |
| Uploads without a session | `<data_dir>/attachments/<id>/`; moved into the session when sent, removed after 24 h otherwise |
| Update hand-over | `state/update.json` in the settings home, while the launcher restarts after an update |
| Temporary files | `<data_dir>/temp/` — cleared on every API start and stop |

`data_dir` is set in Settings → Paths. API keys: settings, with `.env` as an optional fallback.

## Lesson files

```text
output/<job_id>/
  clean_speech.mp3                 clean speech, 128 kbps
  clean_video.mp4                  jump-cut, H.264 CRF, +faststart
  time_map.json                    spans: orig_start/end <-> clean_start/end
  segments.json                    THE canonical transcript (both timelines)
  transcript_clean.srt             derived from segments.json
  transcript_orig.srt
  transcript_clean_timestamps.txt
  transcript_orig_timestamps.txt
  transcript_plain.txt
  lesson_audit.md                  audit, timecodes on the clean timeline
  lesson_audit.orig.md             lessons migrated from the older format only: the original audit
```

## Export (Obsidian)

```text
<export_dir>/
  audio/       <Title>_raw.wav (when exporting right after processing)
  compressed/  <Title>.mp3, <Title>.mp4, <Title>_time_map.json, <Title>_segments.json
  content/     <Title>_audit.md
  srt/         <Title>.srt, <Title>_orig.srt
  txt/         <Title>.txt, <Title>_timestamps.txt, <Title>_orig_timestamps.txt
  <Title>.md   the audit at the root, for navigation
```
