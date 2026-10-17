# Architecture

## Layers

```text
api/routes  ->  services  ->  core  ->  utils
   (HTTP)        (state)     (algorithms)  (fs, processes)
settings: read by every layer; holds paths and keys
```

- `api` — HTTP only: validation, status codes, serialisation.
- `services` — state: `storage` (`LibraryDB`: the JSON database under one `RLock` plus a file lock, atomic writes, the MCP change signal; `Projects`, `Lessons`, `LessonFiles` on top of it), `JobRegistry`
  (jobs, upload/export counters, the answer to "is the system busy?"), export, assistant, migration, diary.
- `core` — algorithms with no knowledge of HTTP: media, VAD, transcription, AI, pipeline, time.

## Pipeline

One background worker (`ThreadPoolExecutor(max_workers=1)`): Whisper and FFmpeg saturate the machine anyway,
so extra jobs wait in the queue as `pending`. The queue holds at most `settings.queue_limit` jobs waiting and running
(10 by default, 1–100, Settings → Processing): `JobRegistry.create` counts and inserts in one locked step and raises
`QueueFull`, which every job-starting route answers with `429`.

Texts the user reads (job stages and warnings, API errors, update and uninstall texts) come from `backend/i18n.py`:
`tr(key, **params)` in the interface language at the moment the text is made, RU and EN with the same keys and
parameters. Logs are not translated; prompts live in `core/ai/prompts.py`. `tests/test_architecture.py` rejects
Cyrillic string literals elsewhere in `backend/` (docstrings and comments aside) and keys missing from either language.
The Inbox notebook stores `""` as its name and description until the user sets them; the UI shows "Входящие" / "Inbox"
(`AppProvider`), and older libraries' Russian defaults are read as unset.

Options are one field per step (`PipelineDefaults`: `cut_silence`, `video`, `transcriber`, `audit`, `audit_source`,
`output_language`, plus fine-tuning). A validator makes impossible combinations possible (original video → no cutting; video analysis → Gemini
and a video; no transcript → audit from video or none) and translates pre-1.4 settings (`mode`, `clean_video`,
`generate_audit`). The UI mirrors those rules (`features/jobs/PipelineOptionsFields.tsx:normalize`); the server decides.

| Step | stage | What it does |
|---|---|---|
| ExtractAudioStep | extract | 16 kHz mono WAV; ffprobe reads the video FPS |
| DetectSpeechStep | vad | only with `cut_silence`: Silero VAD → speech spans, **boundaries snapped to video frames** |
| BuildCleanAudioStep | audio | spans (or the whole file) with 5 ms micro-fades → MP3, `time_map.json`; with an original video no MP3, an identity `time_map` |
| BuildVideoStep | video | `clean`: the same spans → `trim/atrim` + `concat`; `compressed`: the whole video; both H.264 (x264 / NVENC), `+faststart`. `original`: nothing encoded — a path stays where it is (Eco), an upload moves into the lesson (`Lesson.original_file`) |
| TranscribeStep | transcribe | Whisper (local) or Gemini (audio to the cloud) → `segments.json`; audio from `JobContext.speech_audio()` |
| GenerateAuditStep | audit | DeepSeek/Gemini/ChatGPT/Claude/the local model from the `[MM:SS]` transcript, or Gemini from the video (an optimized proxy + the transcript of each part; parts of 45 min as offsets in one upload); a failed video audit falls back to the transcript; during processing an AI failure is only a warning |
| SaveLessonStep | save | store the lesson (with `cut_silence`, `original_file`, `original_kind`), optional export |

Media of a lesson is resolved in one place, `LessonFiles.media(lesson, kind)`: the lesson's own MP3/MP4, else the
original recording. Player, downloads, export and MCP all use it. An Eco lesson whose file is gone reports
`source_missing`; `POST /relink` accepts the same recording at a new path (length checked). `POST /drop-video` keeps
the sound (a kept upload gives its sound to an MP3 first; a user's own Eco file is never deleted). Job warnings are a list
(`JobContext.warn`), so one step cannot hide another's.

`JobContext.cleanup()` runs in `finally`: the temporary WAV and the uploaded source are removed on error and on cancel too.
Cancellation is a `JobCancelled` exception, checked between steps and inside long operations.

Audit regeneration (`POST /api/lessons/{id}/audit`) is the same runner with `[GenerateAuditStep(strict), SaveLessonStep]`.

**Languages of a lesson** (`core/language.py`). `TranscribeStep` stores `speech_language`: the recognition language when
it was set explicitly (`ru` / `en`), else `detect()` on the transcript (share of Cyrillic letters; `""` for too little
text). `GenerateAuditStep` writes the audit in `resolve(output_language, ui_language, speech_language)`: `interface`
(default) = the interface language, `recording` = the language spoken (the interface language when unknown), or an
explicit `ru` / `en`; the result is `audit_language`. Both are saved with the lesson; the lesson page offers to rebuild an
audit written in another language than the recording, and "Regenerate audit" takes a language (`language` in the request).

## Timecode system

Two timelines:

- **clean** — pauses removed. `clean_speech.mp3` and `clean_video.mp4` play on it; every timecode in the UI and in audits uses it.
- **orig** — the original recording. Informational only (transcript tooltip, `transcript_orig.*`).

Guarantees:

1. Audio and video are cut by the same spans, snapped to the frame grid, so their clean timelines are identical.
   The video step measures the duration drift (`stats.av_drift_sec`) and warns above 0.5 s.
2. `time_map.json` is built from the samples actually written, not from requested seconds.
3. The canonical transcript is `segments.json` (`clean_start/end`, `orig_start/end`, `text`). All txt/srt files are derived.
4. The AI receives compact `[MM:SS] text` lines on the clean timeline. Its answer goes through `normalize_timecodes`:
   one format, timecodes beyond the duration are dropped.
5. `TimeMap.orig_to_clean` maps a point inside a removed pause to the cut point.

Migration of older lessons (`services/migration.py`, at startup, idempotent): lessons in the pre-release format had no `transcript_clean.srt` and their
audits were built from `transcript_orig.srt`. The migration builds `segments.json`, regenerates the derived files and moves
audit timecodes to the clean timeline; the original audit is kept as `lesson_audit.orig.md`.

## AI

- `core/ai/prompts.py` is the only place with prompt text (audit A/B, merging of parts, assistant, Gemini transcription,
  and the framing of an assistant request: SOURCES / SUMMARY / FILES / QUESTION, which `services/context_window.py` only
  assembles). Prompts are written in **English** — models follow English instructions most reliably — and the output
  language is a parameter: an audit names its language explicitly ("Write everything in Russian…"), the assistant answers
  in the language of the question, and in the interface language for quick actions without a typed question. The default
  questions of quick actions (`ROLE_DEFAULT_QUESTIONS`) exist in both interface languages.
  It is split into **editable blocks** (`BLOCKS`: role, style, the audit structure, assistant base instruction and
  tasks, compaction) and the **contract** (the `[MM:SS]` format and where times go in an audit, `[[lesson@MM:SS]]`
  citations, keeping references when compacting, part/merge mechanics). No editable default holds a time or citation
  format (`tests/test_prompt_safety.py`); the contract always comes **after** the user's blocks and says it overrides
  them, so no custom text can make timecodes unclickable. Users override blocks in Settings → Instructions; overrides
  live in `settings.json: prompts`, untouched blocks use the defaults. Overrides of the two old structure blocks
  (`audit.structure_timed` / `_plain`) move into `audit.structure` once at startup (`prompts.migrate_overrides`).
- Audit provider: the one chosen (DeepSeek, Gemini, ChatGPT = `openai`, Claude = `anthropic`, the local model); an audit from the video is Gemini's only; "Whisper only" → the provider chosen
  in Settings → AI. `AI.configured()` says whether one is ready (a key, or a chosen local model).
- **Our own context window** (`services/context_window.py`). Chat APIs are stateless: every question re-sends everything.
  One request = system prompt + session summary and recent messages (≤ 25% of the window) + the files attached to this
  question, read by id from disk (≤ 20%) + sources (audit + transcript, the rest, split between lessons) + the question. Window per provider,
  in tokens, set in Settings → AI (`settings.ai.context_tokens`; default DeepSeek 64k, Gemini 400k, ChatGPT 128k, Claude 200k, local 8k; from 8k up to the
  model's `max_context_tokens`: 128k, 1M; the server rejects values outside, a hand-edited file is clamped,
  `AI.context_tokens`). The budget counts characters: `CHARS_PER_TOKEN` = 3 (core/ai/base.py, a low estimate for Russian,
  timecodes and code), and 1/8 of the window stays free for the answer. When the verbatim history outgrows its share, everything but
  the last 4 messages is folded by the model into a "medium" summary (~6% of the window, prompt block `assistant.compact`,
  editable); folded messages stay visible, only the summary is sent. The UI reads the same numbers (`Thread.context`).
  When sources are cut to fit (`sources_trimmed`, with `sources_whole` of `sources_count` lessons and `sources_share` of
  the text), the assistant says so above the input and offers Gemini's large window: on a big course DeepSeek's 64k
  otherwise answers "about the whole course" from a part of it.
- **Sessions** (`services/chats.py`): a thread (lesson or notebook) holds sessions — branches with their own history,
  summary and files. Each session is a folder, `<data_dir>/sessions/<id>/`: `context/session.json` (everything written
  in it and its thread) and `local_session_src/` (its files, `services/attachments.py`). `notebook_db.json` keeps only
  the index `threads["<kind>:<id>"] = {active, sessions: [ids]}`; older libraries (sessions inside the index, or a flat
  list of messages) are moved out with their files at startup (`chats.migrate`). A file joins the session's folder the
  moment it is added (a pasted screenshot survives the clipboard), goes to the model only with the message it is attached
  to, and can be attached again from the paperclip; a removed draft chip deletes it unless a sent message holds it. The
  first, unsaved session of a thread has a stable id (derived from the thread), so a file pasted before the first
  question lands in that question's session.
- **The assistant's sources rule** (`assistant.base`): answers are grounded in the lessons and cited; when they do not
  cover a question, or the user asks for general knowledge, the model says so and answers from its own knowledge under
  "Beyond the lecture:", without timecodes.
- `BaseAIProvider.generate_audit` exists once: a long transcript is split into ~30k-character parts, each part becomes
  notes, then a final merge. Nothing is truncated. A provider with a small window (`audit_window_tokens()`, the local
  model) gets parts sized to it (a quarter of the window, at least 1k tokens, stays for the answer, 10% margin), and when
  the parts' notes do not fit one request they are merged in rounds first (`_fit_notes`).
- **Local model** (`providers/local.py`): Ollama or LM Studio at `settings.ai.local_base_url`, model `local_model`, no key.
  Ollama is asked through its own `/api/chat`, the only way to set the context window per request (`options.num_ctx` =
  the window setting; its OpenAI endpoint keeps the server default of a few thousand tokens and cuts longer prompts
  silently); other servers through OpenAI `/v1/chat/completions`. `POST /api/settings/local/check` lists the models and,
  where the server says, their context length (`/api/show`, LM Studio `/api/v0/models`). A server that does not answer
  fails at once with "start Ollama or LM Studio" (`ai.local_down`), no retries; `<think>` blocks of reasoning models are
  dropped.
- **Retries** (`core/ai/retry.py`): every cloud call (Gemini text and transcription, DeepSeek, ChatGPT, Claude) goes through `with_retry`; Anthropic's 529 (overloaded) counts as temporary like 503.
  503/429/5xx, timeouts and dropped connections are retried 5 times over ~1 minute (cancellable); other errors fail at
  once; exhausted retries raise `AIUnavailable` with a plain explanation.
- **Transcription inside processing is soft**, like the audit: if it fails, the lesson is saved with its clean audio and
  video and a warning; `POST /api/lessons/{id}/transcribe` (`TRANSCRIBE_STEPS`) redoes only recognition (+ audit).
- Providers (`DeepSeekProvider`, `GeminiProvider`, `OpenAIProvider`, `AnthropicProvider`, `LocalProvider`) implement
  transport only. ChatGPT: Chat Completions (`max_completion_tokens`; reasoning models gpt-5*/o* get no temperature),
  the account's chat models from `/v1/models` (cached an hour) or a short default list. Claude: the Messages API
  (`x-api-key`, `anthropic-version`, `system` as its own field). Both take images in the assistant, like Gemini. The UI
  lists the cloud providers from one array (`CLOUD_PROVIDERS` in `features/system/KeyNotice.tsx`), then the local model. Registration via the `AIMeta` metaclass.
- Default audit style: slide notes, one line per point, no softening, "Wrong: …" / "Simplification: …" said plainly.
  Settings → Instructions lists the blocks collapsed, titled by key (`prompt.<key>.title` / `.hint` in the UI dictionaries);
  a user's own (possibly Russian) block text is sent as written.

## Diary

`services/diary.py`. Entries are plain Markdown files `<data_dir>/diary/<category>/<YYYY-MM-DD HHMMSS>.md`;
categories are folders (as in Obsidian — `diary/` can be opened as a vault). No index: the files are the source of truth.
An entry's title is its first line; its creation date comes from the file name. Deleting a category moves its entries
to the inbox. The entry id `<category>/<file>.md` is checked so it cannot escape `diary/`.

## Updates

`services/updates.py`. A release is a git tag `vX.Y.Z`, a pre-release `vX.Y.Z-beta.N` (also `-alpha.N`, `-rc.N`;
`1.0.0-beta.9 < 1.0.0-rc.1 < 1.0.0`); `config.APP_VERSION` is what runs. `pyproject.toml` writes a pre-release the
Python way (`1.0.0b1`) and `config.release_name` turns it into the tag name (`1.0.0-beta.1`). The check fetches tags
(no tag newer than the running version = nothing to offer, unreleased commits on `main` are never offered; tags of other
shapes, like the old releases renamed `alpha-*`, are ignored). Pre-releases are offered when Settings → Interface →
"Get beta versions" is on (`beta_updates`) or a pre-release runs; a beta user then gets the release that follows too.
A release-zip install asks the GitHub releases list (not `/releases/latest`, which skips pre-releases).
The dialog lists the annotated tag's body as release notes, or the commit subjects up to the tag for a lightweight tag.
Applying requires an idle system, a clean working tree and a fast-forward (no local commits). "Discard changes" in the
dialog (`discard_changes()`) resets the tracked files that differ from HEAD (line endings alone count) and checks again;
untracked files are never touched. Then:

1. the API writes `state/update.json` (`from_sha`, versions) and runs `git merge --ff-only vX.Y.Z`;
2. it starts the launcher detached in update mode (`start.zsh update`, `start.ps1 -Mode update`) and gets stopped by it;
3. the launcher syncs dependencies if lock files changed, rebuilds the interface if its sources changed and starts the
   server, keeping the app window;
4. if a dependency sync or the interface build fails, or the server does not come up (a dead process fails at once), it
   runs `git reset --keep <from_sha>` and starts again in rollback mode. The build goes to `frontend/dist.next` and
   replaces `dist` only when it succeeded, so the rollback pass finds the previous interface in place;
5. the starting API compares `update.json` with its version and reports the outcome; the launcher deletes the file.

6. if the launcher never starts (antivirus, policy), the old server is still alive 15 s later and `launcher.log` was not
   touched: `check()` reports `restart_failed` and the UI says the code is updated and the shortcut finishes the job.

On Windows the launcher is started like the shortcut, `wscript start.vbs update` (and `rollback`): a hidden detached
`powershell.exe` spawned by Python is the pattern Defender kills silently. The installer and the launcher judge `npm ci`
and `npm run build` by their result (`node_modules\vite`, `dist.next\index.html` exist), not by the exit code, which
`cmd /c npm` reports wrongly on Windows.
Both check Node.js against the range Vite 8 accepts (`^20.19.0 || >=22.12.0`; `Update-Node` in `common.ps1`, `node_ok` in
the macOS scripts, `tests/test_node_check.py`): the installers upgrade an older one once, the Windows launcher too
(`winget upgrade`), the macOS launcher says `brew upgrade node`.

Installs without `.git` (the release zip) are told about a new release and get a link; they update by running Setup again.

Which release is newer is decided by the version number only; the tag date (`released_at`, `current_released_at`) is
shown next to it. All subprocess output is decoded as UTF-8 explicitly (an architecture test enforces it): with the
locale default Windows read git and ffprobe output as cp1252.

## Serving the interface

One server process (`backend/serve.py`) listens on two ports with the same app: **5173** is the app window's origin
(the built UI from `frontend/dist` plus `/api`), **3000** is the API for the launchers, the stop scripts and
`npm run dev`. The UI port is the one Vite used to serve, on purpose: localStorage (player positions, bookmarks, theme,
sidebar state) belongs to the origin, so installs that ran the Vite UI keep all of it, with no migration.

`api/frontend.py` answers every GET outside `/api`: a file of `dist` (`/assets/*` hashed, `immutable`; others
`no-cache`), a missing file is 404, any other path gets `index.html` (`no-cache`) for the React router. Unknown `/api/…`
stays the API's JSON 404. The Host and Origin guards (`api/guard.py`) sit in front of both. `.js`/`.css`/`.svg` types
are registered explicitly: Windows can map `.js` to `text/plain` in the registry, and browsers refuse such module scripts.

Who builds `dist`: the launcher, by fingerprint of `frontend/src`, `public`, `index.html`, `package*.json`, `vite.config.ts`
and the `tsconfig`s (git clones, GitHub ZIPs, every update); `setups/macos/build-setup.zsh` for the release Setup.zip,
from the same HEAD it packs, marked `frontend/dist/.prebuilt`. With that marker Setup and the launcher skip Node.js
entirely. Development keeps Vite (`npm run dev`) with its proxy to 3000.

## Videos

`services/videos.py` + `routes/videos.py`, the page is `pages/VideosPage.tsx` (sidebar → Videos). Only YouTube for
now. Everything goes through yt-dlp on this computer (a Python dependency in `uv.lock`), run as `python -m yt_dlp` in a
child process: an updated yt-dlp is used at once, a cancel stops it and its ffmpeg, progress is read line by line.
Search is yt-dlp's `ytsearch20` (no Google keys); thumbnails and the embedded player (`youtube-nocookie.com`) load in
the browser straight from YouTube, the server only searches and downloads. A download is a job of its own (kind
`download`, stage `download`) in the common queue and its limit, on its own worker (network, not CPU), into
`paths().downloads`; the Studio then makes a lesson of the file like of any file on disk, with the title filled in.
The first download asks once to confirm the rights notice (kept in settings). YouTube breaks yt-dlp often: Settings →
Processing shows its version and updates it in place.

## Feedback

`services/feedback.py` + `routes/feedback.py`, the form is `features/feedback/Feedback.tsx` (sidebar). A report is a
draft folder under `<settings home>/feedback/drafts/<id>` (opened-at time, uploaded files); sending checks the honeypot
(`website`), the fill time (≥ 3 s), message length, files (types, 5 files, 4 MB together: the relay's request limit),
then the cooldown (60 s) and the daily limit (10, `feedback/sent.json`). Diagnostics on request: version, OS, the
compute plan, the last 200 lines of `server.log` / `launcher.log`, anything key-shaped masked. The report moves to
`feedback/outbox/<id>` and is posted (multipart, header `X-Lecture-Studio`) to `config.FEEDBACK_URL`; on failure it
stays and `flush()` retries at startup and after the next delivery. The app holds no secret: `feedback-relay/` is a
Vercel function that holds the Gmail app password, checks the same limits again (plus a per-IP rate limit) and mails
the report. Screenshots are shrunk in the browser (longest side 2200 px, JPEG) before upload.

## Uninstall

`services/uninstall.py`. `preview()` lists the app folder, the settings home and the data folder, and refuses when the
library lies inside a folder that goes (unless it is deleted too) or the app folder holds git work not on GitHub.
`start()` writes a tab-separated plan (`pid`, `ui_port`, `profile`, `message`, `remove`, `remove_if_empty`) to a temp
folder, copies `launcher/macos/remove.zsh` or `launcher/windows/remove.{vbs,ps1}` there and starts it detached;
the route then stops everything. The script waits for the API to exit, closes the UI and the app window, deletes the
plan's paths and our Desktop shortcut (checked by bundle id / `start.vbs` target), never the root or anything containing
the home folder, and shows the final message. With "delete lessons" only the library items are listed; the data folder
itself goes only if nothing else is left in it.

`setups/macos/Uninstall.app` / `setups/windows/Uninstall.cmd` only ask the questions; `python -m backend.tools.uninstall describe | run`
applies the same rules. `run` goes through the API when the server on the port is this install (it stops everything and
refuses while busy), starts the remover directly when nothing runs, and refuses when another copy's server answers.

## Platforms

- **Compute** (`core/compute.py`): `probe()` — what the machine has (NVIDIA CUDA through torch, the Apple GPU through MLX,
  cores via `utils/proc.py`, the Windows launcher's `state/compute.json`); `plan(preference, cpu_threads)` — `cuda` / `apple` /
  `cpu` with threads and, for the CPU, the reason. Any local model asks the same plan. **Quiet mode**
  (`ComputeSettings.quiet`, Settings → AI → Compute): half the cores by default, FFmpeg at low priority (`nice` /
  `BELOW_NORMAL_PRIORITY_CLASS`, `media/base.py:low_priority`, set per job by the runner), x264 capped to those threads,
  and steps never run at once.
- **Steps at once** (`pipeline/runner.py`): neighbouring steps with the same `together` key — the video encode and the
  transcription — run in two threads when each `may_overlap` (not quiet; recognition on a GPU or Gemini, never Whisper on
  the CPU next to x264). Progress adds up, the stage is the first unfinished one, a cancel reaches both.
- **Video encoder** (`core/media/video.py:pick_encoder`): `nvenc` (h264_nvenc, constant quality `-cq` = the CRF number,
  spatial/temporal AQ for text) when the compute plan is `cuda` and the FFmpeg build has it, else `x264`. NVENC errors
  re-encode with x264; `JobStats.video_encoder` records which one made the file. VideoToolbox is not used (measured worse).
- **Engines** (`core/transcription/engines.py`): one interface, `FasterWhisperEngine` (CUDA float16 / CPU int8, N threads;
  batched and greedy — `BatchedInferencePipeline`, 16 pieces at once on CUDA (halved on out-of-memory), 8 on the CPU,
  4 when quiet: 2.5x faster than one-by-one beam 5 on the CPU with the same words;
  on Windows `torch/lib` is added to the DLL path for cuBLAS/cuDNN) and `MlxWhisperEngine` (Apple GPU, 5-minute windows for
  progress and cancel). A new engine is a subclass in `ENGINES`. `whisper.transcribe(plan=…)` runs the plan's engine; a GPU
  failure is recorded (`compute.mark_failed`) and the job continues on the CPU.
- **torch on Windows**: extras `cpu` / `cu126` (mutually exclusive, both pinned in `uv.lock`); the launcher picks one by
  probing `nvidia-smi` and syncs with `--extra`; the fingerprint includes the build, so a driver/card change re-syncs.

- Settings home `config.APP_HOME`: macOS `~/Library/Application Support/Lecture Studio`, Windows `%APPDATA%\Lecture Studio`,
  Linux `~/.local/share/lecture-studio`. `LECTURE_STUDIO_HOME` overrides it.
- Processes (shutdown, finding the app window, the UI port) go through `utils/proc.py` (psutil). Stopping itself:
  SIGTERM on POSIX, SIGINT via `signal.raise_signal` on Windows, so uvicorn exits cleanly and lifespan clears temp.
- A second server on the same data folder (a dev instance next to the running app) leaves the first one's `temp/`
  and pid file alone.
- **Script language.** Setup, Uninstall and the launchers speak the language of the OS, not of the app (it may not be
  installed yet): Russian when the system is Russian, English otherwise. Every text is `L ru en`: `common.ps1`
  (`Get-UICulture`), the same `os_lang` / `L` lines in `install.zsh`, `start.zsh`, `stop.zsh` (the first of
  `AppleLanguages`; `LECTURE_STUDIO_LANG=ru|en` overrides), `my L(…)` in the `.applescript` files. The uninstall tool gets
  the dialogs' language through `LECTURE_STUDIO_LANG`, which `backend/i18n.py` puts before the interface setting.
  `tests/test_script_language.py` runs the macOS helper and checks that every Russian line has its English twin.

## Principles

- **SOLID / DRY**: one time module, one prompt module, one transcript writer, one `JobRegistry`, one process helper.
- **Duck typing**: `BaseMediaProcessor.normalize_spans` accepts dicts, objects with `.start/.end` and tuples; unit is seconds.
- **Privacy**: video is processed locally only.
