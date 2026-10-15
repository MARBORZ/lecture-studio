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
| GET / PATCH | `/api/settings` | settings (keys are masked, with their source: settings / env / none) |
| POST | `/api/settings/test-key` | test a key with one tiny model request |
| GET | `/api/settings/prompts` | AI instruction blocks: default, current, modified |
| PUT / DELETE | `/api/settings/prompts/{key}` | save a custom block text / reset to default |
| GET | `/api/settings/providers` | AI providers and models |
| POST | `/api/settings/check-path` | check a folder (exists, writable, contains a library) |
| POST | `/api/settings/data-dir` | switch the data folder: `attach` or `move`; refused while busy |
| GET / POST | `/api/projects` | notebooks |
| PATCH / DELETE | `/api/projects/{id}` | rename / delete (lessons move to the inbox) |
| GET | `/api/lessons?project_id&status&search` | lesson list |
| GET / PATCH / DELETE | `/api/lessons/{id}` | full lesson / partial update / delete with files |
| GET | `/api/lessons/{id}/media/{audio,video}` | streaming with HTTP Range (instant seeking) |
| GET | `/api/lessons/{id}/files/{kind}` | download: audio, video, audit, srt, orig_srt, txt, clean_ts, orig_ts, segments, time_map |
| POST | `/api/lessons/{id}/export` | export to a folder (default: from settings) |
| POST | `/api/lessons/{id}/audit` | regenerate the audit (background job) |
| PUT | `/api/uploads/{filename}` | streamed upload into `temp/` (body = file bytes) |
| POST | `/api/jobs` | start: `{options, upload_id?}` or `options.local_path` |
| GET | `/api/jobs`, `/api/jobs/{id}` | jobs |
| GET | `/api/jobs/stream` | SSE: the full job list on every change |
| POST | `/api/jobs/{id}/cancel` | cancel |
| GET / POST / DELETE | `/api/assistant/{project\|lesson}/{id}` | chat: history / ask (`attachments: [id]`) / clear (deletes its attachments) |
| PUT | `/api/assistant/attachments/{filename}` | upload a chat attachment, any type, up to 500 MB (body = file bytes) |
| GET | `/api/assistant/attachments/{id}/file` | download an attachment |
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
| Chat attachments | `<data_dir>/attachments/<id>/` (original file, `content.txt`, `meta.json`); unreferenced ones older than 24 h are removed on start |
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
