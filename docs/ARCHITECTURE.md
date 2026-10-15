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
- The assistant's context budget depends on the provider (`context_chars`: DeepSeek ~90k characters, Gemini ~600k).
- `BaseAIProvider.generate_audit` exists once: a long transcript is split into ~30k-character parts, each part becomes
  notes, then a final merge. Nothing is truncated.
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

Installs without `.git` (the release zip) are told about a new release and get a link; they update by running Setup again.

## Platforms

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
