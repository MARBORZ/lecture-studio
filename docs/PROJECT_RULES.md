# Project rules

The rules the code keeps; `tests/test_architecture.py` checks most of them on every test run.

1. **Timecodes are on the clean timeline only.** `clean_video.mp4` and `clean_speech.mp3` play on it. All time handling goes
   through `backend/core/timeline.py` (backend) and `frontend/src/lib/time.ts` (frontend). The canonical transcript is
   `segments.json`; every txt/srt file is derived (`core/transcription/writer.py`).
2. **Prompts live only in `backend/core/ai/prompts.py`.** Editable blocks (`BLOCKS`: role, style, structure, assistant tasks)
   are overridden by the user in Settings → Instructions (`settings.json: prompts`); read them via `prompts.text(key)`.
   The contract (timecode/citation format, part merging) is not editable. Prompts are in English; the output language is
   a parameter (audit: `core/language.py:resolve`, the interface language by default; assistant: the language of the
   question). Default style: slide notes, no softening, no emoji. Providers implement transport only.
3. **Video goes to the cloud only when the user picks "audit from video" (Gemini), never by default**, and then only as
   an optimized copy (480p, 1 fps, quiet mono: `core/media/video.py:make_analysis_proxy`). Otherwise cloud models get
   audio (Gemini transcription) or text only.
4. **User data never goes into the repository.** Paths come from `SettingsService.paths()` (`Paths`: db, output, temp,
   diary, attachments), never built from `data_dir` elsewhere.
5. **Frontend: one provider, no duplicate components.** `AppProvider` (`useUI` / `useLibrary` / `useJobs`); the player is an
   external store (`features/player/store.ts`). UI primitives in `components/ui`, loading states in `components/skeleton`,
   animation only through `components/motion` + `lib/motion.ts`. Monochrome palette, lucide SVG icons via `components/Icon.tsx`.
   Strings in `i18n/ru.ts` + `en.ts`; server texts the user reads go through `backend/i18n.py` (`tr`), logs stay as they are.
6. **Processes and platforms:** process handling only via `backend/utils/proc.py` (psutil, macOS/Windows/Linux).
   Windows scripts: `.ps1` in UTF-8 with BOM, CRLF (see `.gitattributes`); shared helpers in `launcher/windows/common.ps1`.
   Setup / Uninstall / launcher texts follow the OS language: every one is `L "ru" "en"` (`my L(…)` in AppleScript).
7. **Diary** — `services/diary.py`: plain `.md` files in `<data_dir>/diary/<category>/`, no index (files are the source of truth).
8. **API types are generated** (`npm run gen:api`), never hand-written. Regenerate after changing backend models.
9. Before committing: `uv run ruff check .`, `uv run pytest` (includes `tests/test_architecture.py`, which enforces these
   rules), `npm --prefix frontend run lint`, `npm --prefix frontend run build`.
