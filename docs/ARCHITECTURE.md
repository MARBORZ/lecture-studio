# Architecture

## Layers

```text
api/routes  ->  services  ->  core  ->  utils
   (HTTP)        (state)     (algorithms)  (fs, processes)
settings: read by every layer; holds paths and keys
```

- `api` — HTTP only: validation, status codes, serialisation.
- `services` — state: `Library` (JSON database under one `RLock`, atomic writes), `JobRegistry`
  (jobs, upload/export counters, the answer to "is the system busy?"), export, assistant, migration, diary.
- `core` — algorithms with no knowledge of HTTP: media, VAD, transcription, AI, pipeline, time.

## Pipeline

One background worker (`ThreadPoolExecutor(max_workers=1)`): Whisper and FFmpeg saturate the machine anyway,
so extra jobs wait in the queue as `pending`.

| Step | stage | What it does |
|---|---|---|
| ExtractAudioStep | extract | 16 kHz mono WAV; ffprobe reads the video FPS |
| DetectSpeechStep | vad | Silero VAD → speech spans; **boundaries snapped to video frames** |
| BuildCleanAudioStep | audio | concatenation with 5 ms micro-fades → MP3, `time_map.json` |
| BuildCleanVideoStep | video | the same spans → `trim/atrim` + `concat`, H.264 CRF, `+faststart` |
| TranscribeStep | transcribe | Whisper (local) or Gemini (audio to the cloud) → `segments.json` |
| GenerateAuditStep | audit | audit from the `[MM:SS]` transcript; during processing an AI failure is only a warning |
| SaveLessonStep | save | store the lesson, optional export |

`JobContext.cleanup()` runs in `finally`: the temporary WAV and the uploaded source are removed on error and on cancel too.
Cancellation is a `JobCancelled` exception, checked between steps and inside long operations.

Audit regeneration (`POST /api/lessons/{id}/audit`) is the same runner with `[GenerateAuditStep(strict), SaveLessonStep]`.

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

- `core/ai/prompts.py` is the only place with prompt text (audit A/B, merging of parts, assistant, Gemini transcription).
  It is split into **editable blocks** (`BLOCKS`: role, style, audit structure A/B, assistant base instruction and tasks)
  and the **contract** (`[MM:SS]` format, `[[lesson@MM:SS]]` citations, part/merge mechanics). Users override blocks in
  Settings → Instructions; overrides live in `settings.json: prompts`, untouched blocks use the defaults.
  The contract is always appended by the system, so a custom style cannot break clickable timecodes.
- Audit provider: DeepSeek mode → DeepSeek, Gemini → Gemini, "Whisper only" → the provider chosen in Settings → AI.
- **Our own context window** (`services/context_window.py`). Chat APIs are stateless: every question re-sends everything.
  One request = system prompt + session summary and recent messages (≤ 25% of the window) + session files read by id
  from disk (≤ 20%) + sources (audit + transcript, the rest, split between lessons) + the question. Window per provider:
  `context_chars` (DeepSeek ~90k characters, Gemini ~600k). When the verbatim history outgrows its share, everything but
  the last 4 messages is folded by the model into a "medium" summary (~6% of the window, prompt block `assistant.compact`,
  editable); folded messages stay visible, only the summary is sent. The UI reads the same numbers (`Thread.context`).
- **Sessions** (`services/chats.py`): a thread (lesson or notebook) holds sessions — branches with their own history,
  summary and files. Stored in `notebook_db.json` under `threads`; the old flat list of messages is read as one session.
- `BaseAIProvider.generate_audit` exists once: a long transcript is split into ~30k-character parts, each part becomes
  notes, then a final merge. Nothing is truncated.
- **Retries** (`core/ai/retry.py`): every cloud call (Gemini text and transcription, DeepSeek) goes through `with_retry`.
  503/429/5xx, timeouts and dropped connections are retried 5 times over ~1 minute (cancellable); other errors fail at
  once; exhausted retries raise `AIUnavailable` with a plain explanation.
- **Transcription inside processing is soft**, like the audit: if it fails, the lesson is saved with its clean audio and
  video and a warning; `POST /api/lessons/{id}/transcribe` (`TRANSCRIBE_STEPS`) redoes only recognition (+ audit).
- Providers (`DeepSeekProvider`, `GeminiProvider`) implement transport only. Registration via the `AIMeta` metaclass.
- Default audit style: slide notes, one line per point, no softening, "Wrong: …" / "Simplification: …" said plainly.
  The default texts are in Russian; output follows the lecture language.

## Diary

`services/diary.py`. Entries are plain Markdown files `<data_dir>/diary/<category>/<YYYY-MM-DD HHMMSS>.md`;
categories are folders (as in Obsidian — `diary/` can be opened as a vault). No index: the files are the source of truth.
An entry's title is its first line; its creation date comes from the file name. Deleting a category moves its entries
to the inbox. The entry id `<category>/<file>.md` is checked so it cannot escape `diary/`.

## Updates

`services/updates.py`. A release is a git tag `vX.Y.Z`; `config.APP_VERSION` is what runs. The check fetches tags
(no tag newer than the running version = nothing to offer, unreleased commits on `main` are never offered).
The dialog lists the annotated tag's body as release notes, or the commit subjects up to the tag for a lightweight tag.
Applying requires an idle system, a clean working tree and a fast-forward (no local commits); then:

1. the API writes `state/update.json` (`from_sha`, versions) and runs `git merge --ff-only vX.Y.Z`;
2. it starts the launcher detached in update mode (`start.zsh update`, `start.ps1 -Mode update`) and gets stopped by it;
3. the launcher syncs dependencies if lock files changed and starts everything, keeping the app window;
4. if the API or UI does not come up (a dead API process fails at once), it runs `git reset --keep <from_sha>`
   and starts again in rollback mode;
5. the starting API compares `update.json` with its version and reports the outcome; the launcher deletes the file.

6. if the launcher never starts (antivirus, policy), the old server is still alive 15 s later and `launcher.log` was not
   touched: `check()` reports `restart_failed` and the UI says the code is updated and the shortcut finishes the job.

On Windows the launcher is started like the shortcut, `wscript start.vbs update` (and `rollback`): a hidden detached
`powershell.exe` spawned by Python is the pattern Defender kills silently. The installer and the launcher judge `npm ci`
by its result (`node_modules\vite` exists), not by its exit code, which `cmd /c npm` reports wrongly on Windows.

Installs without `.git` (the release zip) are told about a new release and get a link; they update by running Setup again.

## Platforms

- **Compute** (`core/compute.py`): `probe()` — what the machine has (NVIDIA CUDA through torch, the Apple GPU through MLX,
  cores via `utils/proc.py`, the Windows launcher's `state/compute.json`); `plan(preference, cpu_threads)` — `cuda` / `apple` /
  `cpu` with threads and, for the CPU, the reason. Any local model asks the same plan.
- **Engines** (`core/transcription/engines.py`): one interface, `FasterWhisperEngine` (CUDA float16 / CPU int8, N threads;
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

## Principles

- **SOLID / DRY**: one time module, one prompt module, one transcript writer, one `JobRegistry`, one process helper.
- **Duck typing**: `BaseMediaProcessor.normalize_spans` accepts dicts, objects with `.start/.end` and tuples; unit is seconds.
- **Privacy**: video is processed locally only.
