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

- **Sidebar**: ⌘B / Ctrl+B or the panel button collapses it to an icon rail (notebooks become monograms);
  the state is remembered per browser.
- **Lesson**: a splitter between the video and the content sets the video width (drag, ←/→, double-click to reset;
  remembered). **Focus mode** (player button or **F**, Esc to leave) hides the sidebar, the lesson header and everything
  under the player — only the video and the content remain. Not fullscreen; the window stays a normal window.
- **Player**: Space play/pause, ←/→ 5 seconds, speed up to 2×, audio/video switch keeps the position.

## First run

`features/onboarding/Onboarding.tsx`. Until `settings.json` has `onboarding_done: true`, `AppShell` shows only the tutorial:
language first (both languages on screen; the choice is written to `ui_language` right away), then 10 steps
(app, library, studio, lesson, assistant, diary, AI keys, settings, start/shut down, done). A step rail on the left,
text and a mini-mockup built from the app's own components and i18n keys (`illustrations.tsx`) on the right;
the AI keys step uses the real `KeyField`. Keys ←/→/Enter. "Get started" only closes the tutorial — the user stays where
they were. Replay: Settings → Interface (`useUI().setTutorialOpen`) — no language question, closable with ×/Esc,
the `onboarding_done` flag is untouched.

## State

`app/AppProvider.tsx` is the only provider. Inside it there are three contexts, so job progress does not re-render the library:

- `useUI()` — settings, `t()`, `openModal`, `confirm`, `promptText` (single-value input), `toast`, stopped screen,
  tutorial replay, focus mode;
- `useLibrary()` — notebooks, lessons, mutations;
- `useJobs()` — jobs from SSE, in-tab uploads.

The player is an external store (`features/player/store.ts`, `useSyncExternalStore`): `currentTime` updates only its
subscribers. One `<video>` or `<audio>` element on one clean timeline.

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
- `components/motion` — Appear, ListItem, RouteOutlet, ActiveMark (see Animation).
- `components/Icon.tsx` — the single lucide wrapper (SVG only, `currentColor`).
- `features/jobs/PipelineOptionsFields` — one processing-options form for the Studio and Settings → Processing.
- `features/system/KeyField` — API key field (Settings → AI and the tutorial).

## Animation

Motion (`motion/react`) with one config, `lib/motion.ts`: curves (`ease` for entering, `easeIn` for leaving, `easeInOut`
for scene changes), durations, springs, presets (`fadeUp`, `fadeIn`, `pop`, `fade`, `slide`, `collapse`, `sceneOut`,
`sidebarIn`, `contentIn`) and a capped list stagger (`itemDelay`). Set up once in `main.tsx` with `LazyMotion` and
`MotionConfig reducedMotion="user"` (the OS "reduce motion" setting is respected). Screens use only the wrappers from
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
- Simple hover/press feedback is plain CSS transitions.

## Style

Monochrome only: background `#000`, surfaces `#0a0a0a`/`#121212`, lines `#222`/`#3a3a3a`, text `#fafafa`/`#c8c8c8`/`#8f8f8f`.
Status is shown by shape: ring = studying, half = review, filled = done.
One control height scale: sm 28 · md 36 · lg 40 (Button, IconButton, Input, Segmented); one height per row.

## API types

`npm run gen:api` dumps the backend's OpenAPI without starting the server and generates `src/api/schema.d.ts`.
`src/api/types.ts` holds aliases only. Hand-written copies of models are not allowed.
