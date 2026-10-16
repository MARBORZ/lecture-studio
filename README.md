# Lecture Studio

A local, NotebookLM-style studio for recorded lectures and screencasts.
It cuts the silence out of a recording, builds a clean jump-cut video, transcribes it, writes a blunt
"slide-notes" audit with clickable timecodes, and lets you ask questions across your lessons with citations
that jump to the exact moment in the video. Video never leaves your machine.

> **Read this first.** Lecture Studio was built to solve one specific personal task: turning long recorded
> programming lessons into something I can study quickly. It is shared as-is, in case it is useful to someone
> else. It is not a product, there is no roadmap and no support promise. It is developed and used on macOS;
> the Windows installer and launcher are written but have **not been run on real Windows yet**.

## What it does

- **Silence cutting.** Silero VAD finds speech; pauses are removed with 5 ms micro-fades. Audio and video are
  cut by the same frame-aligned spans, so the clean audio and the clean video share one timeline.
- **Jump-cut video.** FFmpeg trims and concatenates the same spans and compresses with H.264 CRF (`+faststart`
  for instant seeking). Typical OBS recordings shrink a lot while code on screen stays readable.
- **Transcription.** Local Faster-Whisper (`large-v3-turbo`) or Google Gemini (audio only, never video).
- **Audit.** DeepSeek or Gemini writes structured notes in a blunt, no-filler "speaker notes" style, with
  `[MM:SS]` timecodes. Long lectures are processed in parts and merged; nothing is truncated.
  The instructions are editable in **Settings → Instructions**; the timecode format stays system-owned so clicks keep working.
- **Lesson workspace.** Player with chapter markers, synced transcript, audit with clickable timecodes,
  per-lesson assistant, downloads and an Obsidian-style export. The video can be popped out into a floating window
  or an always-on-top window and keeps playing while you move around the app; each lesson resumes where you left it.
  Your own named marks on the timeline (M) take you back to the moments worth rewatching.
- **Assistant sessions and a visible context window.** Chats are split into sessions you switch between, like branches.
  A meter shows what each question sends (sources, files, history), in tokens, against the window; the window is yours to
  set per provider in Settings → AI (a larger window costs more per question); long histories are compressed into a
  summary automatically. Attach any file once — PDFs, Office documents and code are read as text,
  images are seen by Gemini — and it stays in the session. Select text in an answer or the audit to ask about it.
- **Notebooks.** Lessons are grouped into notebooks (courses). A notebook chat answers from the lessons you tick,
  with citations like "Lesson 2 · 04:15" that open the lesson at that moment.
- **Diary.** A quick-capture stream of Markdown notes in categories. Plain `.md` files, so the folder opens in Obsidian.
- **Focus mode and resizable video.** Drag the divider between the video and the content, or press **F** to hide
  everything except the video and the content (Esc to leave).
- **Studio** is a four-step wizard: file → lesson → processing (engine cards say what runs locally and what goes to the
  cloud) → start. Temporary cloud failures (overload, rate limits) are retried; if transcription still fails, the lesson
  is saved with its clean audio and video, and **Recognize speech** in the lesson redoes only that step.
- **Notebooks** can have a cover image. **Diary** entries fold to their title; long ones open as previews.
- **Interface.** Monochrome, light or dark (follows the system by default), adjustable reading text size (80–150%),
  keyboard-friendly, English and Russian. ⌘B / Ctrl+B collapses the sidebar.
  A short tutorial runs on first start (language first) and can be replayed from Settings → Interface.
- **Updates.** When a new release is tagged, the sidebar offers it with the list of changes. One click moves the code to
  the release and restarts the app; if the new version does not start, the previous one comes back automatically.
  Lessons and settings are never touched. Settings → Interface → Check for updates.
- **MCP server.** AI agents (Claude Code, Claude Desktop, Cursor, Cline) can read lessons, search transcripts and
  write audits through the bundled MCP server.

## Install

```bash
git clone https://github.com/MARBORZ/lecture-studio.git
```

| | macOS | Windows 10/11 (untested) |
|---|---|---|
| Run | Finder → `Setup` in the project folder (double-click) | Explorer → `Setup.cmd` in the project folder (double-click) |
| Installs | Homebrew (asks for the admin password in a system dialog), uv, Node.js, FFmpeg | uv (official installer), Node.js and FFmpeg via winget (UAC may ask) |
| Result | **Lecture Studio** icon on the Desktop | **Lecture Studio** shortcut on the Desktop |
| Settings, keys, logs | `~/Library/Application Support/Lecture Studio/` | `%APPDATA%\Lecture Studio\` |

Setup shows a progress window: tools → Python dependencies and models (5–15 minutes) → interface → lessons folder
(default `~/Lecture Studio`) → shortcut. The app runs from the cloned folder. Running Setup again updates dependencies
and the shortcut; lessons and settings are never touched. The install log is `logs/setup.log` in the settings folder.

On macOS, if the clone lives in `~/Desktop` or `~/Documents`, the system asks once for access to that folder — allow it.

Without git (macOS only): `Lecture-Studio-Setup.zip` from [Releases](https://github.com/MARBORZ/lecture-studio/releases)
is the same Setup with the code inside; it installs into `~/Library/Application Support/Lecture Studio/app`.
The app is not notarized, so open it the first time with right-click → Open.

### After installing

1. Open **Lecture Studio** from the Desktop. The first start shows the tutorial.
2. **Settings → AI**: paste a DeepSeek and/or Gemini API key and press **Test**. One key is enough.
   Keys are stored only on this computer, in `settings.json` (file mode 600). No `.env` needed.
3. **Studio**: drop a recording or paste a path to a file on disk. The lesson appears in the Library when done.

## Start and stop

The Desktop shortcut starts everything from a clean slate: old processes are stopped, dependencies are synced when
lock files changed, the API (`127.0.0.1:3000`) and the UI (`127.0.0.1:5173`) start, and an app window opens
(app mode of the first Chromium browser found: Chrome, Edge, Brave, Chromium, Vivaldi — on Windows Edge last; with its
own profile. Without one, a tab in the default browser: it works, but the shortcut opens a new tab each time and
Shut down cannot close it).

**Shut down** at the bottom of the sidebar stops the API, the UI and the window. It refuses while something is
processing, uploading or exporting, and tells you what. From a terminal: `zsh launcher/macos/stop.zsh` or
`powershell -ExecutionPolicy Bypass -File launcher\windows\stop.ps1`.

## Delete

**Settings → Interface → Delete Lecture Studio** removes the app folder (code, `.venv`, `node_modules`), the settings
folder (settings, API keys, logs, app-window profile) and the Desktop shortcut. Lessons stay unless you tick
"Delete lessons too"; then only the library itself goes (database, media, diary, chats), never other files in that
folder. The app window closes, and a message says what was kept and how to install again: `git clone` into the same
folder and Setup, or Lecture Studio Setup for a zip install. A folder with git work that is not on GitHub (a developer
checkout) is never deleted.

Without opening the app: `Uninstall` (macOS) or `Uninstall.cmd` (Windows) in the project folder, next to Setup. Same
rules and questions; if the app is running it is stopped first (refused while it is processing). On macOS, an
`Uninstall` outside a clone deletes the Setup install in `~/Library/Application Support/Lecture Studio/app`.

## Where things live

| What | Where |
|---|---|
| Code | this repository |
| Lessons (database, media, transcripts, audits, diary) | the data folder from Settings → Paths; never in git |
| Settings, API keys, logs, app-window profile | the settings folder above |

The data folder can be switched or moved at runtime in Settings → Paths.

## Privacy

Video is processed only locally. Cloud models receive either audio (Gemini transcription, if you choose it) or text
(transcripts for audits and the assistant). With Whisper selected and no AI audit, nothing leaves the machine.

## GPU and CPU

Local speech recognition runs on the GPU when there is a usable one, several times faster than on the CPU:

- **Apple Silicon:** the Apple GPU through MLX Whisper (about 7× faster than the CPU on an M-series Mac).
- **Windows + NVIDIA:** CUDA. Setup and every launch probe the card with `nvidia-smi`: compute capability 5.0+ (Maxwell
  and newer) and driver 528+ get the CUDA 12.6 build of torch (~2.5 GB), anything else the CPU build (~200 MB). A new driver
  or card switches the build by itself on the next launch. Force one with `LS_TORCH_BUILD=cpu` or `cu126`. The decision is
  in `state\compute.json` and in `logs\launcher.log` / `setup.log` ("torch: …").
- **Settings → AI → Where speech recognition runs:** Auto / GPU / CPU and the number of CPU threads (all cores by
  default), with a line saying what the next job will use and, on the CPU, why. A GPU that fails at runtime hands the job
  to the CPU instead of failing it.
- **Video encoding** follows the same plan: on an NVIDIA GPU the jump-cut video is encoded with NVENC (much faster than
  x264 on a laptop CPU; files somewhat larger at the same quality), falling back to x264 on any NVENC error. On a Mac it
  stays x264: the Apple hardware encoder was measured slower than x264 with 6–9× larger files on screen recordings.

## Known limitations

- Built and used on macOS (Apple Silicon); Windows is tested by a friend on Windows 11 + RTX 3080. Linux has no launcher.
- Requires Node.js 20.19+ or 22.12+ (what Vite 8 accepts, `engines` in `frontend/package.json`). Setup and the launcher
  check it: an older Node.js is upgraded once (`winget upgrade OpenJS.NodeJS.LTS`, `brew upgrade node`), otherwise they
  say which version is needed.
- Self-update needs a clean app folder: local code edits block it (the update dialog lists the files and has
  "Discard changes"; a local commit blocks it too). If git reports "dubious ownership", the update dialog shows the `git config --global --add safe.directory` command.
- **Windows, updating from 1.2.0 or older:** the update is restarted by the old version's code, which can fail silently
  there. If the update screen does not change for a minute, close the window and start Lecture Studio from the shortcut —
  it finishes the update. From 1.2.1 on, the restart goes through the shortcut's own path.
- One processing job at a time (Whisper and FFmpeg saturate the machine anyway); others wait in a queue.
- The default AI instructions are written in Russian; the audit is written in the lecture's language.
  Change them in Settings → Instructions.
- The macOS app and Setup are ad-hoc signed, not notarized.

## Development

```bash
uv sync                                    # Python 3.12 + dependencies (pyproject.toml / uv.lock)
uv run uvicorn backend.main:app --port 3000 --reload
npm --prefix frontend run dev              # http://127.0.0.1:5173, /api is proxied to :3000

uv run ruff check .                        # Python lint
uv run pytest                              # backend tests + architecture rules (tests/test_architecture.py)
npm --prefix frontend run lint
npm --prefix frontend run build            # tsc + vite build
npm --prefix frontend run gen:api          # regenerate TypeScript API types from the backend's OpenAPI
```

To run a second instance next to the installed app:
`LECTURE_STUDIO_HOME=/tmp/ls LS_API_PORT=3001 uv run uvicorn backend.main:app --port 3001` and
`LS_API_PORT=3001 LS_UI_PORT=5174 npm --prefix frontend run dev`. The macOS launcher honours the same variables
(plus `LS_NO_WINDOW=1`), which is how self-update is tested end to end without touching the running app.

Releasing: `uv version X.Y.Z` (the only version source, `pyproject.toml`), commit, then an annotated tag whose body is
the release notes (`git tag -a vX.Y.Z`, one `- item` per line), push `main` and the tag. Installed apps show those notes
in the update dialog on their next check.
A beta: `uv version 1.0.0b1`, tag `v1.0.0-beta.1`, `gh release create --prerelease`. Only beta users and those who
turned on "Get beta versions" are offered it.

Stack: FastAPI, Silero VAD, Faster-Whisper, FFmpeg, DeepSeek / Gemini, React 19, Vite, TypeScript, Tailwind 4, Motion.

Documentation: [docs/](docs/README.md).

## License

[MIT](LICENSE) — use it, change it, share it. Provided as is, without warranty.
