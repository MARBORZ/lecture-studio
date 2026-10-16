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
Setup.app, Uninstall.app      macOS, double-click (built by installer/macos/build-setup.zsh from the .applescript files)
Setup.cmd, Uninstall.cmd      Windows, double-click
installer/macos/              install.zsh (steps), Setup.applescript, Uninstall.applescript, build-setup.zsh
installer/windows/            install.ps1 (progress window, steps), uninstall.ps1 (questions)
assets/                       icon.svg, setup-icon.svg, icon.ico
mcp_server.py                 MCP server on top of services
tests/                        pytest
```
