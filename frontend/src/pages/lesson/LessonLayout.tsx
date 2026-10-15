import { ArrowLeft, FileText, FolderOutput, MessagesSquare, Paperclip, Pencil, RefreshCw, ScrollText, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router'
import { api } from '@/api/client'
import type { LessonFull, LessonStatus } from '@/api/types'
import { useJobs, useLibrary, useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { ActiveMark, AnimatePresence, m, RouteOutlet } from '@/components/motion'
import { EmptyState, IconButton, Segmented, Splitter, Stat } from '@/components/ui'
import { SkeletonMarkdown, SkeletonPlayer, SkeletonText } from '@/components/skeleton'
import { ExportModal, LessonEditModal } from '@/features/library/modals'
import { MarkdownView } from '@/features/markdown/MarkdownView'
import { MediaPlayer, type Chapter } from '@/features/player/MediaPlayer'
import { player, usePlayer } from '@/features/player/store'
import { cn } from '@/lib/cn'
import { formatDuration, storage } from '@/lib/format'
import { collapse } from '@/lib/motion'
import { extractChapters, findActiveIndex, formatTc } from '@/lib/time'
import { useResource } from '@/lib/useResource'
import { isTyping } from '@/lib/keys'

export interface LessonContext {
  lesson: LessonFull
  reload: () => Promise<void>
  regenerate: () => Promise<void>
}

export const useLesson = () => useOutletContext<LessonContext>()

const DEFAULT_PLAYER_WIDTH = 44

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
  const { t, openModal, confirm, toast, settings, lang, focusMode, setFocusMode, modals } = useUI()
  const splitRef = useRef<HTMLDivElement>(null)
  const [playerWidth, setPlayerWidth] = useState(() => storage.get('lesson.playerWidth', DEFAULT_PLAYER_WIDTH))

  // Focus mode: F toggles, Esc leaves (unless a dialog is open); leaving the lesson always ends it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') setFocusMode((v) => !v)
      else if (e.key === 'Escape' && !modals.length) setFocusMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setFocusMode, modals.length])
  useEffect(() => () => setFocusMode(false), [setFocusMode])
  const { lessons, patchLesson, deleteLesson, projectName } = useLibrary()
  const { jobs } = useJobs()
  const res = useResource(() => api.lesson(lessonId), [lessonId])
  const lesson = res.data
  const meta = lessons.find((l) => l.id === lessonId)
  const chapters = useMemo(() => extractChapters(lesson?.lesson_audit_md ?? ''), [lesson?.lesson_audit_md])

  // media + deep link ?t=
  useEffect(() => {
    if (!lesson) return
    player.load(lesson.id, lesson.audio_url ?? null, lesson.video_url ?? null)
    const t0 = search.get('t')
    if (t0) {
      player.seek(Number(t0), true)
      setSearch((p) => (p.delete('t'), p), { replace: true })
    }
  }, [lesson, search, setSearch])
  useEffect(() => () => player.unload(), [lessonId])

  // reload when a job for this lesson finishes (e.g. audit regeneration)
  const finished = jobs.filter((j) => j.lesson_id === lessonId && j.status === 'completed').length
  const seen = useRef(finished)
  useEffect(() => {
    if (finished > seen.current) void res.reload()
    seen.current = finished
  }, [finished, res])

  async function regenerate() {
    const ok = await confirm({ title: t('lesson.regenerate'), text: t('lesson.regenerateText'), confirmLabel: t('lesson.regenerate') })
    if (!ok) return
    try {
      await api.regenerateAudit(lessonId, settings?.ai.assistant_provider, settings?.pipeline.audit_mode)
      toast(t('lesson.regenerateStarted'))
    } catch (e) {
      toast((e as Error).message, 'error')
    }
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
                <IconButton icon={RefreshCw} size="sm" label={t('lesson.regenerate')} disabled={!current.has_transcription} onClick={regenerate} />
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

      <div ref={splitRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <aside
          style={{ ['--player-w' as string]: `${playerWidth}%` }}
          className="flex shrink-0 flex-col gap-5 p-6 lg:w-[var(--player-w)] lg:overflow-y-auto lg:p-8"
        >
          {lesson ? <MediaPlayer chapters={chapters} /> : <SkeletonPlayer />}
          <AnimatePresence initial={false}>
          {!focusMode && (
          <m.div key="player-extras" variants={collapse} initial="hidden" animate="show" exit="exit" className="flex flex-col gap-5 overflow-hidden">
          {lesson && (
            <div className="grid grid-cols-3 gap-3 rounded-xl border border-line px-4 py-3">
              <Stat label={t('lesson.clean')} value={formatDuration(lesson.clean_duration_sec ?? 0, lang)} />
              <Stat label={t('lesson.original')} value={formatDuration(lesson.orig_duration_sec ?? 0, lang)} />
              <Stat label={t('lesson.saved')} value={`${Math.round(lesson.saved_percent ?? 0)}%`} />
            </div>
          )}
          {chapters.length > 0 && <Chapters chapters={chapters} />}
          {meta?.notes && (
            <section>
              <div className="label-caps mb-2">{t('common.notes')}</div>
              <MarkdownView content={meta.notes} compact className="rounded-xl border border-line p-4" />
            </section>
          )}
          </m.div>
          )}
          </AnimatePresence>
        </aside>

        <Splitter
          containerRef={splitRef}
          value={playerWidth}
          min={28}
          max={72}
          label={t('lesson.resize')}
          onChange={setPlayerWidth}
          onCommit={(v) => storage.set('lesson.playerWidth', v)}
          onReset={() => {
            setPlayerWidth(DEFAULT_PLAYER_WIDTH)
            storage.set('lesson.playerWidth', DEFAULT_PLAYER_WIDTH)
          }}
          className="hidden lg:block"
        />

        <section className="flex min-h-[70vh] min-w-0 flex-1 flex-col lg:min-h-0">
          <nav className="flex gap-1 border-b border-line px-6 lg:px-8">
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
  const { t } = useUI()
  const starts = useMemo(() => chapters.map((c) => c.t), [chapters])
  const active = usePlayer((s) => findActiveIndex(starts, s.currentTime + 0.5))
  return (
    <section>
      <div className="label-caps mb-2">{t('lesson.outline')}</div>
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
    </section>
  )
}
