# Lecture Studio documentation

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Backend layers, pipeline, the timecode system, AI and prompts, diary, platforms |
| [API_AND_STORAGE.md](API_AND_STORAGE.md) | REST API, SSE, lesson files, settings and paths, export |
| [FRONTEND.md](FRONTEND.md) | React app: routes, the provider, player, Markdown, animation, style |
| [MCP_REFERENCE.md](MCP_REFERENCE.md) | The 10 tools of the `lecture-studio` MCP server |
| [CLAUDE_SETUP.md](CLAUDE_SETUP.md) | Connecting Claude Code / Claude Desktop / Cursor |

## Repository map

```text
backend/
  main.py, api/app.py         FastAPI (:3000); lifespan: temp cleanup, import, migration
  api/routes/                 system, settings, projects, lessons, jobs, assistant, diary
  settings/                   AppSettings + SettingsService.paths() — every data path comes from here
  i18n.py                     server texts the user reads, RU / EN, in the interface language (tr)
  models/                     pydantic schemas by role (job, lesson, project, transcript, assistant, diary, system)
  core/timeline.py            the only time module (clean <-> orig, formats, normalisation)
  core/media/                 ffmpeg, AudioProcessor, VideoProcessor
  core/vad.py                 Silero VAD
  core/language.py            the audit's language: detect (transcript script), resolve (interface / recording / explicit)
  core/transcription/         whisper, gemini, writer (segments.json -> txt/srt)
  core/ai/                    prompts.py (English, output language as a parameter), base (audit), providers (deepseek, gemini), facade
  core/pipeline/              steps and runner (single-worker queue)
  services/                   storage (Library), jobs (JobRegistry), export, assistant, migration, diary
  utils/                      fs (files, BOM-tolerant reads), proc (processes, cross-platform)
frontend/                     React 19 + Vite + TypeScript + Tailwind 4 + SCSS + Motion
launcher/macos/               start.zsh, stop.zsh, remove.zsh (uninstall worker), build-app.zsh, make-icon.zsh, stub.c
launcher/windows/             common.ps1 (shared helpers), start.ps1, start.vbs (no console), stop.ps1, remove.{vbs,ps1} (uninstall worker)
setups/macos/                 Setup.app, Uninstall.app (double-click; built by build-setup.zsh from the .applescript files),
                              install.zsh (steps), Setup.applescript, Uninstall.applescript, build-setup.zsh
setups/windows/               Setup.cmd, Uninstall.cmd (double-click), install.ps1 (progress window, steps), uninstall.ps1 (questions)
assets/                       icon.svg, setup-icon.svg, icon.ico
mcp_server.py                 MCP server on top of services
tests/                        pytest
```

## Running and releasing

The Desktop shortcut starts everything from a clean slate: old processes stop, dependencies sync when lock files
changed, the API (`127.0.0.1:3000`) and the UI (`127.0.0.1:5173`) start, and an app window opens in the first Chromium
browser found (Chrome, Edge, Brave, Chromium, Vivaldi; on Windows Edge last), with its own profile; without one, a tab
in the default browser. **Shut down** in the sidebar stops all three and refuses while something is processing,
uploading or exporting. From a terminal: `zsh launcher/macos/stop.zsh` or
`powershell -ExecutionPolicy Bypass -File launcher\windows\stop.ps1`.

**Deleting** (Settings → Interface, or `setups/<os>/Uninstall`) removes the app folder, the settings folder (settings,
API keys, logs, app-window profile) and the shortcut; lessons stay unless asked, and then only the library itself goes.
A folder with git work that is not on GitHub is never deleted. Details: [ARCHITECTURE.md](ARCHITECTURE.md#uninstall).

**GPU.** Apple Silicon: MLX Whisper on the Apple GPU. Windows + NVIDIA: Setup and every launch probe the card with
`nvidia-smi`; compute capability 5.0+ and driver 528+ get the CUDA 12.6 build of torch (~2.5 GB), anything else the CPU
build. `LS_TORCH_BUILD=cpu|cu126` forces one; the decision is in `state\compute.json` and the launcher log. Video is encoded
with NVENC on NVIDIA (x264 fallback), x264 on a Mac. Settings → AI chooses Auto / GPU / CPU and the CPU threads.

**Self-update** needs a clean app folder: local edits block it (the dialog lists them and has "Discard changes").
Node.js 20.19+ or 22.12+ is required; Setup and the launcher upgrade an older one once.

A second instance next to the installed app:
`LECTURE_STUDIO_HOME=/tmp/ls LS_API_PORT=3001 uv run uvicorn backend.main:app --port 3001` and
`LS_API_PORT=3001 LS_UI_PORT=5174 npm --prefix frontend run dev`. The macOS launcher honours the same variables
(plus `LS_NO_WINDOW=1`): that is how self-update is tested end to end.

Checks before a commit: `uv run ruff check .`, `uv run pytest`, `npm --prefix frontend run lint`,
`npm --prefix frontend run build`; `npm --prefix frontend run gen:api` after changing backend models.

**Releasing:** `uv version X.Y.Z` (the only version source), commit, an annotated tag whose body is the notes
(`git tag -a vX.Y.Z`, one `- item` per line), push `main` and the tag, `gh release create` with
`dist/Lecture-Studio-Setup.zip` (`zsh setups/macos/build-setup.zsh`). A beta: `uv version 1.0.0bN`, tag
`v1.0.0-beta.N`, `--prerelease`; only beta installs and those with "Get beta versions" are offered it.
