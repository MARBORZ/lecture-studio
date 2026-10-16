import { AlertTriangle, ArrowLeft, FileText, FolderSearch, FolderOutput, Languages, MessagesSquare, Paperclip, Pencil, RefreshCw, ScrollText, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router'
import { api } from '@/api/client'
import type { LessonFull, LessonStatus } from '@/api/types'
import { useJobs, useLibrary, useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { ActiveMark, AnimatePresence, m, RouteOutlet } from '@/components/motion'
import { Button, Collapsible, EmptyState, Field, IconButton, Modal, Segmented, Splitter, Stat } from '@/components/ui'
import { SkeletonMarkdown, SkeletonPlayer, SkeletonText } from '@/components/skeleton'
import { ExportModal, LessonEditModal } from '@/features/library/modals'
import { MoveLessonButton } from '@/features/library/MoveLesson'
import { AskFromMoment } from '@/features/assistant/AskFromMoment'
import { MarkdownView } from '@/features/markdown/MarkdownView'
import { VIDEO_TOKENS_PER_HOUR } from '@/features/jobs/PipelineOptionsFields'
import { BookmarkList } from '@/features/player/bookmarks'
import { MediaPlayer, type Chapter } from '@/features/player/MediaPlayer'
import { player, usePlayer } from '@/features/player/store'
import { cn } from '@/lib/cn'
import { formatCount, formatDuration, storage } from '@/lib/format'
import { collapse } from '@/lib/motion'
import { extractChapters, findActiveIndex, formatTc } from '@/lib/time'
import { useResource } from '@/lib/useResource'
import { useHotkey } from '@/features/hotkeys/useHotkey'
import { isTyping } from '@/lib/keys'

export interface LessonContext {
  lesson: LessonFull
  reload: () => Promise<void>
  regenerate: () => void
}

export const useLesson = () => useOutletContext<LessonContext>()

/** Video column width, % of the lesson area. Focus mode has its own (larger) width: the point of it is a big video. */
const WIDTH = {
  normal: { key: 'lesson.playerWidth', initial: 44, min: 28, max: 72 },
  focus: { key: 'lesson.playerWidth.focus', initial: 66, min: 40, max: 82 },
} as const

const TABS = [
  { to: 'notes', icon: FileText, key: 'lesson.notes' },
  { to: 'transcript', icon: ScrollText, key: 'lesson.transcript' },
  { to: 'assistant', icon: MessagesSquare, key: 'lesson.assistant' },
  { to: 'files', icon: Paperclip, key: 'lesson.files' },
] as const

export function LessonLayout() {
  const { lessonId = '' } = useParams()
  const [search, setSearch] = useSearchParams()
  const navigate = useNavigate()
  const { t, openModal, confirm, toast, lang, focusMode, setFocusMode, modals } = useUI()
  const splitRef = useRef<HTMLDivElement>(null)
  const [widths, setWidths] = useState(() => ({
    normal: storage.get<number>(WIDTH.normal.key, WIDTH.normal.initial),
    focus: storage.get<number>(WIDTH.focus.key, WIDTH.focus.initial),
  }))

  // Focus mode: its hotkey toggles (F by default), Esc leaves (unless a dialog is open); leaving the lesson always ends it.
  useHotkey('lesson.focus', () => setFocusMode((v) => !v))
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape' && !modals.length) setFocusMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setFocusMode, modals.length])
  useEffect(() => () => setFocusMode(false), [setFocusMode])
  const width = WIDTH[focusMode ? 'focus' : 'normal']
  const playerWidth = widths[focusMode ? 'focus' : 'normal']
  const setPlayerWidth = (v: number) => setWidths((w) => ({ ...w, [focusMode ? 'focus' : 'normal']: v }))
  const { lessons, patchLesson, deleteLesson, projectName } = useLibrary()
  const { jobs } = useJobs()
  const res = useResource(() => api.lesson(lessonId), [lessonId])
  const lesson = res.data
  const meta = lessons.find((l) => l.id === lessonId)
  const chapters = useMemo(() => extractChapters(lesson?.lesson_audit_md ?? ''), [lesson?.lesson_audit_md])

  // media + deep link ?t=
  useEffect(() => {
    if (!lesson) return
    player.load(lesson.id, lesson.audio_url ?? null, lesson.video_url ?? null, lesson.title ?? '')
    const t0 = search.get('t')
    if (t0) {
      player.seek(Number(t0), true)
      setSearch((p) => (p.delete('t'), p), { replace: true })
    }
  }, [lesson, search, setSearch])
  useEffect(() => {
    if (lesson && player.getState().lessonId === lesson.id) player.setChapters(chapters)
  }, [lesson, chapters])
  const bookmarks = meta?.bookmarks
  useEffect(() => {
    if (lesson && player.getState().lessonId === lesson.id) player.setBookmarks(bookmarks ?? [])
  }, [lesson, bookmarks])
  // Leaving the page stops playback unless the video is out in a window (then it keeps playing).
  useEffect(() => () => player.leave(), [lessonId])

  // reload when a job for this lesson finishes (e.g. audit regeneration)
  const finished = jobs.filter((j) => j.lesson_id === lessonId && j.status === 'completed').length
  const seen = useRef(finished)
  useEffect(() => {
    if (finished > seen.current) void res.reload()
    seen.current = finished
  }, [finished, res])

  function regenerate(language?: 'ru' | 'en') {
    if (!lesson) return
    openModal((close) => <RegenerateAuditModal lesson={lesson} language={language} close={close} />)
  }

  if (res.error) {
    return <EmptyState icon={ArrowLeft} title={t('lesson.notFound')} hint={res.error.message} action={<Link to="/library" className="text-[13px] underline">{t('error.home')}</Link>} />
  }

  const current = meta ?? lesson
  return (
    <div className="flex h-full flex-col">
      <AnimatePresence initial={false}>
        {!focusMode && (
          <m.div key="lesson-header" variants={collapse} initial="hidden" animate="show" exit="exit" className="shrink-0 overflow-hidden">
          <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-6 py-3 lg:px-8">
            <div className="min-w-0 flex-1">
              {current ? (
                <>
                  <Link to={`/library/${current.project_id}`} className="text-[12px] text-muted hover:text-fg">
                    {projectName(current.project_id ?? 'proj_inbox')}
                  </Link>
                  <h1 className="truncate text-[17px] font-semibold tracking-[-0.01em]">{current.title}</h1>
                </>
              ) : (
                <SkeletonText lines={2} className="w-64" />
              )}
            </div>
            {current && (
              <div className="flex items-center gap-1.5">
                <Segmented
                  size="sm"
                  value={current.status ?? 'in_progress'}
                  onChange={(s: LessonStatus) => patchLesson(lessonId, { status: s }).catch((e) => toast(e.message, 'error'))}
                  options={(['in_progress', 'to_review', 'completed'] as const).map((s) => ({ value: s, label: t(`status.${s}`) }))}
                />
                <span className="mx-1 h-5 w-px bg-line" />
                <IconButton icon={Pencil} size="sm" label={t('lesson.edit')} onClick={() => meta && openModal((close) => <LessonEditModal lesson={meta} close={close} />)} />
                {meta && <MoveLessonButton lesson={meta} />}
                <IconButton icon={RefreshCw} size="sm" label={t('lesson.regenerate')} disabled={!current.has_transcription} onClick={() => regenerate()} />
                <IconButton icon={FolderOutput} size="sm" label={t('files.export')} onClick={() => meta && openModal((close) => <ExportModal lesson={meta} close={close} />)} />
                <IconButton
                  icon={Trash2}
                  size="sm"
                  label={t('lesson.delete')}
                  onClick={async () => {
                    if (await confirm({ title: `${t('lesson.delete')}: ${current.title}`, text: t('lesson.deleteText'), danger: true, confirmLabel: t('common.delete') })) {
                      await deleteLesson(lessonId)
                      navigate(`/library/${current.project_id}`)
                    }
                  }}
                />
              </div>
            )}
          </header>
          </m.div>
        )}
      </AnimatePresence>

      {lesson?.source_missing && !focusMode && <SourceMissing lessonId={lesson.id} onRelinked={res.reload} />}
      {lesson && !focusMode && <LanguageMismatch lesson={lesson} onRegenerate={regenerate} />}

      <div ref={splitRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <aside
          style={{ ['--player-w' as string]: `${playerWidth}%` }}
          // @container: paddings and the player bar follow this column's width (the splitter changes it), not the window's.
          // Container queries reach descendants only, so the paddings live on the inner wrapper.
          className={cn('@container shrink-0 lg:w-[var(--player-w)] lg:overflow-y-auto', focusMode && 'flex flex-col')}
        >
          {/* focus mode: only the player is left, centred in the column instead of pinned to its top */}
          <div className={cn('flex flex-col gap-5 p-4 @md:p-6 @2xl:p-8', focusMode && 'min-h-full justify-center')}>
          {lesson ? <MediaPlayer /> : <SkeletonPlayer />}
          {lesson && <AskFromMoment lessonId={lesson.id} segments={lesson.segments ?? []} />}
          <AnimatePresence initial={false}>
          {!focusMode && (
          <m.div key="player-extras" variants={collapse} initial="hidden" animate="show" exit="exit" className="flex shrink-0 flex-col gap-5 overflow-hidden">
          {lesson && (
            <div className="grid grid-cols-3 gap-3 rounded-xl border border-line px-4 py-3">
              <Stat label={t('lesson.clean')} value={formatDuration(lesson.clean_duration_sec ?? 0, lang)} />
              <Stat label={t('lesson.original')} value={formatDuration(lesson.orig_duration_sec ?? 0, lang)} />
              <Stat label={t('lesson.saved')} value={`${Math.round(lesson.saved_percent ?? 0)}%`} />
            </div>
          )}
          {chapters.length > 0 && (
            <Collapsible id="lesson.outline" title={t('lesson.outline')}>
              <Chapters chapters={chapters} />
            </Collapsible>
          )}
          {lesson && (
            <Collapsible id="lesson.bookmarks" title={`${t('bookmark.title')}${meta?.bookmarks?.length ? ` · ${meta.bookmarks.length}` : ''}`}>
              <BookmarkList />
            </Collapsible>
          )}
          {meta?.notes && (
            <Collapsible id="lesson.notes" title={t('common.notes')}>
              <MarkdownView content={meta.notes} compact className="rounded-xl border border-line p-4" />
            </Collapsible>
          )}
          </m.div>
          )}
          </AnimatePresence>
          </div>
        </aside>

        <Splitter
          containerRef={splitRef}
          value={playerWidth}
          min={width.min}
          max={width.max}
          label={t('lesson.resize')}
          onChange={setPlayerWidth}
          onCommit={(v) => storage.set(width.key, v)}
          onReset={() => {
            setPlayerWidth(width.initial)
            storage.set(width.key, width.initial)
          }}
          className="hidden lg:block"
        />

        <section className="@container flex min-h-[70vh] min-w-0 flex-1 flex-col lg:min-h-0">
          <nav className="scroll-area flex gap-1 overflow-x-auto border-b border-line px-4 @xl:px-8">
            {TABS.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={({ isActive }) =>
                  cn('relative flex h-11 items-center gap-2 px-3 text-[13px] transition-colors', isActive ? 'text-fg' : 'text-muted hover:text-soft')
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <ActiveMark layoutId="lesson-tab" variant="underline" />}
                    <Icon as={tab.icon} size={14} />
                    {t(tab.key)}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
          {lesson ? (
            <RouteOutlet depth={3} className="flex min-h-0 flex-1 flex-col" context={{ lesson, reload: res.reload, regenerate } satisfies LessonContext} />
          ) : (
            <div className="p-8">
              <SkeletonMarkdown />
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function Chapters({ chapters }: { chapters: Chapter[] }) {
  const starts = useMemo(() => chapters.map((c) => c.t), [chapters])
  const active = usePlayer((s) => findActiveIndex(starts, s.currentTime + 0.5))
  return (
    <ol className="flex flex-col">
        {chapters.map((c, i) => (
          <li key={`${c.t}-${i}`}>
            <button
              type="button"
              onClick={() => player.seek(c.t, true)}
              className={cn('flex w-full items-baseline gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-surface', i === active ? 'text-fg' : 'text-muted')}
            >
              <span className={cn('w-12 shrink-0 font-mono text-[11.5px]', i === active ? 'text-fg' : 'text-dim')}>{formatTc(c.t)}</span>
              <span className="min-w-0 truncate">{c.title}</span>
            </button>
          </li>
        ))}
    </ol>
  )
}

/** Eco: the recording is no longer at its path. Point the lesson at it again (the server checks it is the same one). */
function SourceMissing({ lessonId, onRelinked }: { lessonId: string; onRelinked: () => Promise<void> }) {
  const { t, promptText, toast } = useUI()
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-fg px-6 py-3 lg:px-8">
      <Icon as={AlertTriangle} size={16} className="shrink-0" />
      <div className="min-w-[14rem] flex-1">
        <p className="text-[13.5px] font-medium text-fg">{t('lesson.sourceMissing')}</p>
        <p className="text-[12.5px] text-muted">{t('lesson.sourceMissingHint')}</p>
      </div>
      <Button
        size="sm"
        variant="primary"
        icon={FolderSearch}
        onClick={async () => {
          const path = await promptText({ title: t('lesson.relink'), label: t('lesson.relinkLabel'), maxLength: 1000 })
          if (!path) return
          try {
            await api.relink(lessonId, path)
            toast(t('lesson.relinked'))
            await onRelinked()
          } catch (e) {
            toast((e as Error).message, 'error')
          }
        }}
      >
        {t('lesson.relink')}
      </Button>
    </div>
  )
}

const isLang = (v: string): v is 'ru' | 'en' => v === 'ru' || v === 'en'

/**
 * The audit came out in a language other than the recording's (e.g. an English lecture, a Russian interface).
 * Offer to rebuild it in the recording language; dismissing it is remembered per lesson.
 */
function LanguageMismatch({ lesson, onRegenerate }: { lesson: LessonFull; onRegenerate: (language: 'ru' | 'en') => void }) {
  const { t } = useUI()
  const key = `lesson.langNotice.${lesson.id}.${lesson.audit_language}`
  const [dismissed, setDismissed] = useState(() => storage.get(key, false))
  const { speech_language: speech, audit_language: audit } = lesson
  if (dismissed || !isLang(speech) || !isLang(audit) || speech === audit || !lesson.has_transcription) return null
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-6 py-3 lg:px-8">
      <Icon as={Languages} size={16} className="shrink-0 text-muted" />
      <div className="min-w-[14rem] flex-1">
        <p className="text-[13.5px] text-fg">{t('lesson.languageMismatch', { audit: t(`lang.name.${audit}`), speech: t(`lang.name.${speech}`) })}</p>
        <p className="text-[12.5px] text-muted">{t('lesson.languageMismatchHint')}</p>
      </div>
      <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => onRegenerate(speech)}>
        {t('lesson.regenerateIn', { language: t(`lang.name.${speech}`) })}
      </Button>
      <IconButton
        icon={X}
        size="sm"
        label={t('common.close')}
        onClick={() => {
          storage.set(key, true)
          setDismissed(true)
        }}
      />
    </div>
  )
}

/** Regenerate the audit: model, source — the transcript, or (Gemini) the lesson's video — and the language. */
function RegenerateAuditModal({ lesson, language: initial, close }: { lesson: LessonFull; language?: 'ru' | 'en'; close: () => void }) {
  const { t, settings, toast, lang } = useUI()
  const [language, setLanguage] = useState<'ru' | 'en'>(initial ?? (isLang(lesson.audit_language) ? lesson.audit_language : lang))
  const [provider, setProvider] = useState<'deepseek' | 'gemini'>(settings?.ai.assistant_provider ?? 'deepseek')
  const [source, setSource] = useState<'transcript' | 'video'>(lesson.has_transcription ? 'transcript' : 'video')
  const [busy, setBusy] = useState(false)
  const canVideo = provider === 'gemini' && Boolean(lesson.video_url)
  const effective = source === 'video' && !canVideo ? 'transcript' : source
  return (
    <Modal
      title={t('lesson.regenerate')}
      description={t('lesson.regenerateText')}
      width="sm"
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={effective === 'transcript' && !lesson.has_transcription}
            onClick={async () => {
              setBusy(true)
              try {
                await api.regenerateAudit(lesson.id, provider, settings?.pipeline.audit_mode, effective, language)
                toast(t('lesson.regenerateStarted'))
                close()
              } catch (e) {
                toast((e as Error).message, 'error')
                setBusy(false)
              }
            }}
          >
            {t('lesson.regenerate')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Segmented value={provider} onChange={setProvider} options={[{ value: 'deepseek', label: 'DeepSeek' }, { value: 'gemini', label: 'Gemini' }]} />
        <Field label={t('lesson.auditSource')} hint={effective === 'video' ? t('opt.auditSource.video.cost', { tokens: formatCount(VIDEO_TOKENS_PER_HOUR, lang) }) : undefined}>
          <Segmented
            value={effective}
            onChange={setSource}
            options={[
              { value: 'transcript', label: t('opt.auditSource.transcript') },
              ...(canVideo ? [{ value: 'video' as const, label: t('opt.auditSource.video') }] : []),
            ]}
          />
        </Field>
        <Field label={t('lesson.auditLanguage')}>
          <Segmented value={language} onChange={setLanguage} options={(['ru', 'en'] as const).map((l) => ({ value: l, label: t(`lang.name.${l}`) }))} />
        </Field>
      </div>
    </Modal>
  )
}
