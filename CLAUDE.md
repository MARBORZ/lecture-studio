# CLAUDE.md

Lecture Studio — a local NotebookLM-style platform: notebooks (projects) and sources (lessons),
VAD silence cutting, jump-cut video, transcripts, blunt audits with timecodes, an assistant with citations, a diary.

## Running

- Desktop shortcut → `launcher/macos/start.zsh` (macOS) or `launcher/windows/start.vbs` → `start.ps1` (Windows).
- Install / remove: `Setup.app`, `Uninstall.app` (macOS), `Setup.cmd`, `Uninstall.cmd` (Windows) in the project root; their
  scripts live in `installer/<os>/`. Shared icons live in `assets/`.
- API: FastAPI `127.0.0.1:3000`. UI: Vite `127.0.0.1:5173` (proxies `/api`).
- Stop: the sidebar button or `launcher/<os>/stop.*` (refused while the system is busy).
- Logs: `<settings home>/logs/{launcher,server,frontend,setup}.log`; settings home is `backend/config.py:APP_HOME`
  (macOS `~/Library/Application Support/Lecture Studio`, Windows `%APPDATA%\Lecture Studio`).

## MCP `lecture-studio`

Enabled through `.mcp.json`. For any question about lessons, lectures or notes, go to MCP first:
`lecture_list_projects`, `lecture_list_lessons`, `lecture_get_lesson_material`, `lecture_search_transcripts`,
`lecture_get_clean_audio_track`, `lecture_get_clean_video_track`, `lecture_save_audit_markdown`,
`lecture_update_lesson`, `lecture_export_to_local_folder`, `lecture_apply_agent_transcription`.
Spec: [docs/MCP_REFERENCE.md](docs/MCP_REFERENCE.md).

## Project rules

1. **Timecodes are on the clean timeline only.** `clean_video.mp4` and `clean_speech.mp3` play on it. All time handling goes
   through `backend/core/timeline.py` (backend) and `frontend/src/lib/time.ts` (frontend). The canonical transcript is
   `segments.json`; every txt/srt file is derived (`core/transcription/writer.py`).
2. **Prompts live only in `backend/core/ai/prompts.py`.** Editable blocks (`BLOCKS`: role, style, structure, assistant tasks)
   are overridden by the user in Settings → Instructions (`settings.json: prompts`); read them via `prompts.text(key)`.
   The contract (timecode/citation format, part merging) is not editable. Default style: slide notes, no softening, no emoji.
   Providers implement transport only.
3. **Video never goes to the cloud.** Cloud models get audio (Gemini transcription) or text only.
4. **User data never goes into the repository.** Paths come from `SettingsService.paths()` (`Paths`: db, output, temp,
   diary, attachments), never built from `data_dir` elsewhere.
5. **Frontend: one provider, no duplicate components.** `AppProvider` (`useUI` / `useLibrary` / `useJobs`); the player is an
   external store (`features/player/store.ts`). UI primitives in `components/ui`, loading states in `components/skeleton`,
   animation only through `components/motion` + `lib/motion.ts`. Monochrome palette, lucide SVG icons via `components/Icon.tsx`.
   Strings in `i18n/ru.ts` + `en.ts`.
6. **Processes and platforms:** process handling only via `backend/utils/proc.py` (psutil, macOS/Windows/Linux).
   Windows scripts: `.ps1` in UTF-8 with BOM, CRLF (see `.gitattributes`); shared helpers in `launcher/windows/common.ps1`.
7. **Diary** — `services/diary.py`: plain `.md` files in `<data_dir>/diary/<category>/`, no index (files are the source of truth).
8. **API types are generated** (`npm run gen:api`), never hand-written. Regenerate after changing backend models.
9. Before committing: `uv run ruff check .`, `uv run pytest` (includes `tests/test_architecture.py`, which enforces these
   rules), `npm --prefix frontend run lint`, `npm --prefix frontend run build`.

Documentation: [docs/README.md](docs/README.md).
