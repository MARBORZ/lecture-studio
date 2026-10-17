import { ArrowLeft, FileText, MessagesSquare, Paperclip, ScrollText } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Link, NavLink, useOutletContext, useParams } from 'react-router'
import { api } from '@/api/client'
import type { LessonFull } from '@/api/types'
import { useLibrary, useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { ActiveMark, m, RouteOutlet, SceneMotion, UserMotion } from '@/components/motion'
import { Collapsible, EmptyState, Splitter, Stat } from '@/components/ui'
import { SkeletonMarkdown, SkeletonPlayer } from '@/components/skeleton'
import { AskFromMoment } from '@/features/assistant/AskFromMoment'
import { MarkdownView } from '@/features/markdown/MarkdownView'
import { BookmarkList } from '@/features/player/bookmarks'
import { MediaPlayer } from '@/features/player/MediaPlayer'
import { cn } from '@/lib/cn'
import { formatDuration, storage } from '@/lib/format'
import { focusFade } from '@/lib/motion'
import { extractChapters } from '@/lib/time'
import { useResource } from '@/lib/useResource'
import { useFocusKeys, useLessonInPlayer, useReloadOnChange } from './hooks'
import { useFocusGlide } from './useFocusGlide'
import { LessonHeader } from './LessonHeader'
import { LanguageMismatch, SourceMissing } from './LessonNotices'
import { RegenerateAuditModal } from './RegenerateAuditModal'
import { Chapters } from './Chapters'

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
  const { t, openModal, lang, focusMode } = useUI()
  const splitRef = useRef<HTMLDivElement>(null)
  const [widths, setWidths] = useState(() => ({
    normal: storage.get<number>(WIDTH.normal.key, WIDTH.normal.initial),
    focus: storage.get<number>(WIDTH.focus.key, WIDTH.focus.initial),
  }))

  useFocusKeys()
  const width = WIDTH[focusMode ? 'focus' : 'normal']
  const playerWidth = widths[focusMode ? 'focus' : 'normal']
  const setPlayerWidth = (v: number) => setWidths((w) => ({ ...w, [focusMode ? 'focus' : 'normal']: v }))
  const { lessons } = useLibrary()
  const res = useResource(() => api.lesson(lessonId), [lessonId])
  const lesson = res.data
  const meta = lessons.find((l) => l.id === lessonId)
  const chapters = useMemo(() => extractChapters(lesson?.lesson_audit_md ?? ''), [lesson?.lesson_audit_md])
  useLessonInPlayer(lessonId, lesson, chapters, meta?.bookmarks)
  useReloadOnChange(lessonId, res.reload)

  const { playerRef, paneRef, asideRef } = useFocusGlide(focusMode)

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
      <SceneMotion>
        {!focusMode && (
          <m.div key="lesson-header" variants={focusFade} initial="hidden" animate="show" className="shrink-0">
          <UserMotion>
          <LessonHeader lessonId={lessonId} current={current} meta={meta} onRegenerate={() => regenerate()} />
          </UserMotion>
          </m.div>
        )}
      </SceneMotion>

      {lesson?.source_missing && !focusMode && <SourceMissing lessonId={lesson.id} onRelinked={res.reload} />}
      {lesson && !focusMode && <LanguageMismatch lesson={lesson} onRegenerate={regenerate} />}

      <div ref={splitRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <aside
          ref={asideRef}
          // the width changes in one step; on a focus switch the player itself glides (flip below)
          style={{ ['--player-w' as string]: `${playerWidth}%` }}
          // @container: paddings and the player bar follow this column's width (the splitter changes it), not the window's.
          // Container queries reach descendants only, so the paddings live on the inner wrapper.
          className="@container flex shrink-0 flex-col lg:w-[var(--player-w)] lg:overflow-y-auto"
        >
          {/* focus mode: only the player is left, and it glides to the middle of the column: two spacers grow from
              nothing to an equal share (real layout every frame, so the video is never stretched by a transform) */}
          <div className="flex min-h-full flex-col p-4 @md:p-6 @2xl:p-8">
          <div aria-hidden className={focusMode ? 'grow' : ''} />
          <div className="flex flex-col gap-5">
          <div ref={playerRef}>{lesson ? <MediaPlayer /> : <SkeletonPlayer />}</div>
          {lesson && <AskFromMoment lessonId={lesson.id} segments={lesson.segments ?? []} />}
          <SceneMotion>
          {!focusMode && (
          <m.div key="player-extras" variants={focusFade} initial="hidden" animate="show" className="flex shrink-0 flex-col gap-5">
          <UserMotion>
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
          </UserMotion>
          </m.div>
          )}
          </SceneMotion>
          </div>
          <div aria-hidden className={focusMode ? 'grow' : ''} />
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

        <section ref={paneRef} className="@container flex min-h-[70vh] min-w-0 flex-1 flex-col lg:min-h-0">
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
