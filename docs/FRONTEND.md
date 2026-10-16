# Frontend

React 19 + Vite + TypeScript, Tailwind 4 (tokens in `styles/index.css`) + SCSS for long-form text (`styles/markdown.scss`),
Motion for animation. Geist / Geist Mono fonts are bundled; no external CDNs.

## Routes

| Path | Screen |
|---|---|
| `/library`, `/library/:projectId` | all lessons / a notebook: search, status filter |
| `/notebooks/:projectId/chat` | NotebookLM-style chat: pick sources, answers with citations |
| `/lessons/:id/notes` | player, outline, audit |
| `/lessons/:id/transcript` | transcript synced with the player |
| `/lessons/:id/assistant` | per-lesson chat |
| `/lessons/:id/files` | downloads and export |
| `/studio` | new processing job, job queue |
| `/diary`, `/diary/:category` | diary: categories, quick capture, feed with in-place editing |
| `/settings/{paths,ai,prompts,processing,interface}` | settings; `prompts` = AI instructions |

`?t=<seconds>` on a lesson URL opens it at that moment (this is how notebook-chat citations work).

## Layout and keyboard

- **Sidebar**: its hotkey (⌘B / Ctrl+B by default) or the panel button collapses it to an icon rail (notebooks become monograms);
  the state is remembered per browser.
- **Lesson**: a splitter between the video and the content sets the video width (drag, ←/→, double-click to reset;
  remembered). **Focus mode** (player button or **F**, Esc to leave) hides the sidebar, the lesson header and everything
  under the player — only the video and the content remain — and has its own, larger video width (66% by default, up to
  82%, remembered separately). Under the video: outline, marks and notes, each a `Collapsible` section (state remembered).
- **Player**: Space play/pause, ←/→ 5 seconds, **M** adds a mark, speed up to 2×, audio/video switch keeps the position,
  fullscreen of the player itself. The moment each lesson was left is remembered (`player.positions`, last 60 lessons) and
  restored on the next visit. **Marks**: the user's own named points (up to 20 characters) — diamonds on the timeline,
  a list under the video; stored with the lesson (`Lesson.bookmarks`). Leaving the lesson page while playing turns the
  player into the floating window; leaving while paused (or Minimize in the window) leaves a pill in the corner that
  waits — Play continues. Coming back to the lesson docks it again.
  The video can leave the page: a **floating window** inside the app (drag, corner resize at 16:9, S/M/L, fullscreen;
  keeps playing across routes, geometry remembered) or an **always-on-top OS window** (Document Picture-in-Picture,
  native video PiP as a fallback). Only one `PlayerSurface` exists at a time; `player.setDisplay` carries time and state over.
- **Studio** (`pages/StudioPage.tsx`): a wizard — file, lesson, processing, start — with the queue beside it. The queue
  is `features/jobs/JobList.tsx`: one row per job (title, one state label that fades between states, progress), details on
  click, running jobs first, finished ones folded to the last 3. "Audit language" sits with the processing options; when
  the recording language is set explicitly and differs from the interface, the form asks which one to write in.
  "Export after processing" without an export folder says why it is off and links to Settings → Paths.
- **Moving a lesson** (`features/library/MoveLesson.tsx`): a button in the lesson header and on a library row opens a
  dialog with the notebooks; a library row can also be dragged onto a notebook in the sidebar (`LESSON_DRAG`). Only
  `project_id` changes; files stay where they are.
- **Lesson languages**: when the audit is written in another language than the recording, the lesson shows a notice
  (dismissed per lesson and language) offering to rebuild it in the recording language; "Regenerate audit" has a language choice.
- **Settings**: the title and the list of sections stay put, only the content scrolls (`.scroll-hidden`: scrolling
  without a visible bar). Settings → Instructions lists the prompt blocks collapsed. Settings → Processing has the job
  queue limit (`features/jobs/QueueLimitCard.tsx`).
- **Diary**: entries fold to their title (one or all, remembered); long ones open as a preview; editors are bounded and
  scroll inside instead of growing the page. An entry moves to another category from the folder icon (a menu opening
  upwards); the inbox category, a Russian folder name on disk, is shown in the interface language (`useCategoryLabel`).
- **Assistant** (`features/assistant`, server calls only in `useThread`): **sessions** (branches of one chat) — a menu to switch,
  rename, delete, a new session starts with an empty history; **Clear** empties the current session (history, summary,
  files). The **context meter** shows how much of the provider's window the next question takes and of what (sources,
  files of this question, history, summary, instruction), with "compress now". Files of any type are attached with the
  paperclip, drag and drop or paste; they are kept in the session's folder at once and go to the model only with the
  message they are attached to. The paperclip menu lists the **files of this session** to attach again (no upload).
  Text is extracted on the server (PDF, DOCX, PPTX, XLSX, text/code); images go to Gemini as images with the
  message they were attached to. **Select text** in an answer or in the audit → "Ask about this" puts it into the input
  as a quote. Without a key for the chosen model the notice offers to switch to the model that has one.

## Adaptive columns

Inside the lesson the video and the content are resizable columns, so their contents follow the **column** width with
Tailwind container queries (`@container` on the column, `@md:` / `@xl:` / `@4xl:` inside), not the window width: the audit
outline shows only when its column is wide enough, paddings shrink in a narrow column, the player bar becomes two full rows.
Container queries style descendants only — paddings live on an inner wrapper.

Hotkeys live in one registry, `lib/hotkeys.ts`: the action ids (the same as the backend catalog,
`backend/settings/hotkeys.py`), matching by the physical key (`e.code`: with a Cyrillic layout Ctrl+B types "и" on
Windows) with exactly the combination's modifiers, and labels (⌃⌥⇧⌘ on macOS, Ctrl+Alt+Shift elsewhere). Components bind
an action with `useHotkey(id, handler, { target, repeat, when })` (`features/hotkeys/useHotkey.ts`); combinations without
⌘/Ctrl stay quiet in text fields, those with them only in rich editors. Labels and hints read the current combination
(`useHotkeyLabel`, `useWithHotkey`). Settings → Hotkeys (`features/hotkeys/HotkeysSettings.tsx`) records a combination,
asks `POST /api/settings/hotkeys/check` and saves it; Esc, Enter, ⌘Enter and paste stay fixed. `tests/test_architecture.py`
forbids key comparisons outside the registry and keeps the ids and their labels in sync.

## Appearance

`settings.json` keeps `theme` (`system` by default, `dark`, `light`) and `text_scale` (80–150, %). `lib/appearance.ts` puts
`data-theme` and `--text-scale` on `<html>` and caches them so `index.html` applies them before the first paint. The light
theme redefines the same color tokens (`styles/index.css`), so components never branch on the theme. Reading text
(markdown, transcript, chat, diary) is sized as `calc(base × --text-scale)` — `.md` and the `.read-13/14/15` classes;
the rest of the UI keeps its size.

## First run

`features/onboarding/Onboarding.tsx`. Until `settings.json` has `onboarding_done: true`, `AppShell` shows only the tutorial:
language first (both languages on screen; the choice is written to `ui_language` right away), then 10 steps
(app, library, studio, lesson, assistant, diary, connect AI, settings, start/shut down, done). A step rail on the left,
text and a mini-mockup built from the app's own components and i18n keys (`illustrations.tsx`) on the right.
The connect-AI step (`AiStep.tsx`) is real controls: Claude through MCP (`McpClients`, no key), an API key (`KeyField`),
a local model, or Skip — cutting, the clean video and Whisper work without AI. Keys ←/→/Enter (Enter on a focused
button presses only that button). "Get started" only closes the tutorial — the user stays where
they were. Replay: Settings → Interface (`useUI().setTutorialOpen`) — no language question, closable with ×/Esc,
the `onboarding_done` flag is untouched.

## Languages

UI strings live in `i18n/ru.ts` and `en.ts` (same keys, `tests/test_architecture.py`). Inside React `t()` comes from
`useUI()`; code outside React (the API client, the router's error screen) uses `tr()` from `i18n/index.ts`, which follows
the language `AppProvider` last set (`setLanguage`). Texts made by the server arrive already in the interface language
(`backend/i18n.py`). The Inbox notebook has no stored name: `AppProvider` shows it as "Входящие" / "Inbox" in every view
until the user renames it.

## State

`app/AppProvider.tsx` is the only provider. Inside it there are three contexts, so job progress does not re-render the library:

- `useUI()` — settings, `t()`, `openModal`, `confirm`, `promptText` (single-value input), `toast`, stopped screen,
  tutorial replay, focus mode;
- `useLibrary()` — notebooks, lessons, mutations;
- `useJobs()` — jobs from SSE, in-tab uploads.

The player is an external store (`features/player/store.ts`, `useSyncExternalStore`): `currentTime` updates only its
subscribers. One `<video>` or `<audio>` element on one clean timeline; `display` = inline / window / pip.

Self-update is the same kind of store (`features/system/updateStore.ts`): `info` from `/api/system/update` (a real check on
every page start — app launch, Cmd+R / Ctrl+Shift+R, `?reload=true`, reusing an answer under 30 s old — then every
3 hours, or from Settings → Interface), and `phase` while the launcher restarts. `phase` lives in
sessionStorage because the page reloads under the restarting server; `UpdatingScreen` waits for a server with a
new pid and reloads. The outcome toast (updated / rolled back) is shown once per outcome.

## Timecodes in text

`features/markdown/remarkLecture.ts` works on the Markdown tree (not HTML):

- `[MM:SS]`, `[HH:MM:SS]` and legacy `` `[..]` `` → the `Timecode` component (seeks the player);
- `[[lesson_id@MM:SS]]` → a chip with the lesson title (opens the lesson at that moment);
- emoji are removed;
- headings get ids for the outline (`Outline`, scrollspy).

## Components

- `components/ui` — Button, IconButton, Field, Input, Textarea, Select, Slider, Switch, Segmented, Card, Page, PageHeader,
  EmptyState, Progress, Stat, StatusMark, Modal, ConfirmDialog, PromptDialog, Splitter. There are no other implementations of these roles.
- `components/skeleton` — Skeleton, SkeletonText, SkeletonCard, SkeletonList, SkeletonPlayer, SkeletonMarkdown, SkeletonChat.
  They appear only after 180 ms (`--animate-skeleton` in `styles/index.css`), so a fast load shows no flash of placeholders.
- `components/motion` — Appear, ListItem, RouteOutlet, ActiveMark (see Animation).
- `components/Icon.tsx` — the single lucide wrapper (SVG only, `currentColor`).
- `features/jobs/PipelineOptionsFields` — one processing-options form for the Studio and Settings → Processing.
- `features/system/KeyField` — API key field (Settings → AI and the tutorial).
- `features/system/McpCard` — `useMcp` + `McpClients`: connect this app to Claude Desktop / Claude Code (Settings → AI and the tutorial).

## Animation

Motion (`motion/react`) with one config, `lib/motion.ts`: curves (`ease` for entering, `easeIn` for leaving, `easeInOut`
for scene changes), durations, springs, presets (`fadeUp`, `fadeIn`, `pop`, `fade`, `slide`, `collapse`, `sceneOut`,
`sidebarIn`, `contentIn`) and a capped list stagger (`itemDelay`). Set up once by `MotionRoot` (`components/motion`: `LazyMotion` +
`MotionConfig reducedMotion="user"`) (the OS "reduce motion" setting is respected). Screens use only the wrappers from
`components/motion`: `Appear`, `ListItem` (in `AnimatePresence`: enter/exit and siblings reflow), `RouteOutlet depth`
(screen change without re-animating the parent), `ActiveMark` (the sliding "you are here" marker in the sidebar, settings,
tutorial, segmented controls and lesson tabs). Modals and toasts animate out too (`AnimatePresence` in `AppShell`).

- Inside something that moves, children only fade (`fadeIn`), never move on their own — no double motion.
- Scenes (`AppShell`, `AnimatePresence mode="wait"`): the tutorial leaves with `sceneOut` (fade, slight zoom, blur), then
  the app assembles — sidebar `sidebarIn`, content `contentIn`. The tutorial finale draws a check (`pathLength`), pops a
  badge (`springBouncy`), breathes rings and staggers section tiles.
- Performance: presets animate only `opacity` and a full `transform` string, which Motion hands to the Web Animations API,
  so they run on the compositor at the display rate even while React mounts the next screen. Elements with `layout`
  (reflowing lists) use the y-based `fadeUpFlow`. The progress bar uses `scaleX`, not `width`.
- Resting state: `show` presets animate to the identity transform and then drop it (`transitionEnd: none`). Animating
  *to* `none` is not interpolated by Motion — screens used to freeze 12 px low, cutting off their bottom edge.
- Simple hover/press feedback is plain CSS transitions.

## Style

Monochrome only: background `#000`, surfaces `#0a0a0a`/`#121212`, lines `#222`/`#3a3a3a`, text `#fafafa`/`#c8c8c8`/`#8f8f8f`.
Status is shown by shape: ring = studying, half = review, filled = done.
One control height scale: sm 28 · md 36 · lg 40 (Button, IconButton, Input, Segmented); one height per row.

## API types

`npm run gen:api` dumps the backend's OpenAPI without starting the server and generates `src/api/schema.d.ts`.
`src/api/types.ts` holds aliases only. Hand-written copies of models are not allowed.
