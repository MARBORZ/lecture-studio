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
  per-lesson assistant, downloads and an Obsidian-style export.
- **Notebooks.** Lessons are grouped into notebooks (courses). A notebook chat answers from the lessons you tick,
  with citations like "Lesson 2 · 04:15" that open the lesson at that moment.
- **Diary.** A quick-capture stream of Markdown notes in categories. Plain `.md` files, so the folder opens in Obsidian.
- **Focus mode and resizable video.** Drag the divider between the video and the content, or press **F** to hide
  everything except the video and the content (Esc to leave).
- **Interface.** Monochrome, keyboard-friendly, English and Russian. ⌘B / Ctrl+B collapses the sidebar.
  A short tutorial runs on first start (language first) and can be replayed from Settings → Interface.
- **MCP server.** AI agents (Claude Code, Claude Desktop, Cursor, Cline) can read lessons, search transcripts and
  write audits through the bundled MCP server.

## Install

```bash
git clone https://github.com/MARBORZ/lecture-studio.git
```

| | macOS | Windows 10/11 (untested) |
|---|---|---|
| Run | Finder → `installer/macos/Setup` (double-click) | Explorer → `installer\windows\Setup.cmd` (double-click) |
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
(Chrome/Edge app mode with its own profile, otherwise the default browser).

**Shut down** at the bottom of the sidebar stops the API, the UI and the window. It refuses while something is
processing, uploading or exporting, and tells you what. From a terminal: `zsh launcher/macos/stop.zsh` or
`powershell -ExecutionPolicy Bypass -File launcher\windows\stop.ps1`.

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

## Known limitations

- Built and used on macOS (Apple Silicon). Windows scripts are untested; Linux has no launcher.
- One processing job at a time (Whisper and FFmpeg saturate the machine anyway); others wait in a queue.
- The default AI instructions are written in Russian; the audit is written in the lecture's language.
  Change them in Settings → Instructions.
- The macOS app and Setup are ad-hoc signed, not notarized.

## Development

```bash
uv sync                                    # Python 3.12 + dependencies (pyproject.toml / uv.lock)
uv run uvicorn backend.main:app --port 3000 --reload
npm --prefix frontend run dev              # http://127.0.0.1:5173, /api is proxied to :3000

uv run pytest                              # backend tests
npm --prefix frontend run lint
npm --prefix frontend run build            # tsc + vite build
npm --prefix frontend run gen:api          # regenerate TypeScript API types from the backend's OpenAPI
```

To run a second instance next to the installed app:
`LECTURE_STUDIO_HOME=/tmp/ls uv run uvicorn backend.main:app --port 3001` and
`LS_API_PORT=3001 LS_UI_PORT=5174 npm --prefix frontend run dev`.

Stack: FastAPI, Silero VAD, Faster-Whisper, FFmpeg, DeepSeek / Gemini, React 19, Vite, TypeScript, Tailwind 4, Motion.

Documentation: [docs/](docs/README.md).

## License

[MIT](LICENSE) — use it, change it, share it. Provided as is, without warranty.
