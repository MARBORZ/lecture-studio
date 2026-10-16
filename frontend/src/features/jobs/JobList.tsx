import { AlertTriangle, ArrowRight, Check, ChevronRight, ListX, Minus, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '@/api/client'
import type { Job } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { AnimatePresence, m } from '@/components/motion'
import { Button, IconButton, Modal, Pagination, Progress, Stat } from '@/components/ui'
import { SkeletonList } from '@/components/skeleton'
import { formatDateTime } from '@/lib/format'
import { useResource } from '@/lib/useResource'
import { cn } from '@/lib/cn'
import { formatDuration } from '@/lib/format'
import { collapse, fade } from '@/lib/motion'

/** What a finished download hands to the Studio (router state): the file on disk and the lesson title. */
export interface StudioHandoff {
  path: string
  title: string
}

/** Finished jobs shown before "show all". */
const RECENT = 3

const isActive = (j: Job) => j.status === 'pending' || j.status === 'processing'

/**
 * The job queue as a compact list: one row per job (title, one state label, progress), details on click.
 * Running jobs first; finished ones fold to the last few.
 */
export function JobList({ jobs, tools = true }: { jobs: Job[]; tools?: boolean }) {
  const { t, toast } = useUI()
  const [all, setAll] = useState(false)
  const active = jobs.filter(isActive)
  const finished = jobs.filter((j) => !isActive(j))
  const shown = [...active, ...(all ? finished : finished.slice(0, RECENT))]
  return (
    <div className="flex flex-col gap-2">
      <div className="scroll-hidden max-h-[min(70vh,40rem)] divide-y divide-line rounded-xl border border-line bg-surface">
        <AnimatePresence initial={false}>
          {shown.map((j) => (
            <m.div key={j.id} layout="position" variants={fade} initial="hidden" animate="show" exit="exit">
              <JobRow job={j} />
            </m.div>
          ))}
        </AnimatePresence>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {finished.length > RECENT && (
          <button type="button" onClick={() => setAll((v) => !v)} className="text-[12px] text-muted hover:text-fg">
            {all ? t('studio.showRecent') : t('studio.showAll', { n: finished.length })}
          </button>
        )}
        {tools && (
          <span className="ml-auto flex items-center gap-1">
            {finished.length > 0 && (
              <button
                type="button"
                onClick={() => api.clearFinishedJobs().catch((e: Error) => toast(e.message, 'error'))}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-muted hover:bg-hover hover:text-fg"
              >
                <Icon as={ListX} size={13} />
                {t('jobs.clearFinished')}
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  )
}

/** One label for the job's state; it fades when the state (not the percentage) changes. */
function StateLabel({ job }: { job: Job }) {
  const { t } = useUI()
  const text = job.cancel_requested && isActive(job)
    ? t('job.cancelling')
    : job.status === 'processing'
      ? t(`stage.${job.stage ?? 'queued'}`)
      : t(`job.${job.status ?? 'pending'}`)
  return (
    <span className="relative block h-4 overflow-hidden text-[11.5px] leading-4 text-muted">
      <AnimatePresence mode="wait" initial={false}>
        <m.span key={text} variants={fade} initial="hidden" animate="show" exit="exit" className="block truncate">
          {text}
        </m.span>
      </AnimatePresence>
    </span>
  )
}

function StateIcon({ job }: { job: Job }) {
  if (isActive(job)) return <span className={cn('size-1.5 rounded-full bg-fg', job.status === 'processing' ? 'animate-pulse-soft' : 'opacity-40')} />
  const icon = job.status === 'completed' ? Check : job.status === 'error' ? AlertTriangle : Minus
  return <Icon as={icon} size={13} className={job.status === 'error' ? 'text-fg' : 'text-muted'} />
}

function JobRow({ job }: { job: Job }) {
  const { t, toast } = useUI()
  const [open, setOpen] = useState(false)
  const active = isActive(job)
  const stages = job.stages ?? []
  const currentIdx = stages.indexOf(job.stage ?? 'queued')

  return (
    <div>
      <div className="flex items-center gap-2 pr-2">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3.5 text-left">
          <span className="flex size-4 shrink-0 items-center justify-center">
            <StateIcon job={job} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] text-fg">{job.title || job.id}</span>
            <StateLabel job={job} />
          </span>
          {active && <span className="shrink-0 font-mono text-[11.5px] text-soft tabular-nums">{job.progress ?? 0}%</span>}
          <Icon as={ChevronRight} size={13} className={cn('shrink-0 text-dim transition-transform', open && 'rotate-90')} />
        </button>
        {active ? (
          <IconButton
            icon={X}
            size="sm"
            label={t('studio.cancelJob')}
            disabled={job.cancel_requested}
            onClick={() => api.cancelJob(job.id).catch((e) => toast(e.message, 'error'))}
          />
        ) : job.status === 'completed' && job.kind === 'download' && job.media_path ? (
          <Link
            to="/studio"
            state={{ path: job.media_path, title: job.title } satisfies StudioHandoff}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-fg hover:bg-hover"
          >
            {t('videos.toStudio')}
            <Icon as={ArrowRight} size={14} />
          </Link>
        ) : job.status === 'completed' && job.lesson_id ? (
          <Link to={`/lessons/${job.lesson_id}/notes`} title={t('studio.openLesson')} aria-label={t('studio.openLesson')} className="flex size-7 items-center justify-center rounded-md text-soft hover:bg-hover hover:text-fg">
            <Icon as={ArrowRight} size={15} />
          </Link>
        ) : null}
      </div>
      {active && <Progress value={job.progress ?? 0} className="h-[2px] rounded-none" />}
      <AnimatePresence initial={false}>
        {open && (
          <m.div key="details" variants={collapse} initial="hidden" animate="show" exit="exit" className="overflow-hidden">
            <JobDetails job={job} stages={stages} currentIdx={currentIdx} />
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function JobDetails({ job, stages, currentIdx }: { job: Job; stages: NonNullable<Job['stages']>; currentIdx: number }) {
  const { t, lang } = useUI()
  const active = isActive(job)
  const text = job.status === 'error' ? job.error : job.message
  return (
    <div className="flex flex-col gap-3 px-3.5 pt-1 pb-3.5 pl-[42px]">
      {text && <p className={cn('text-[12.5px] break-words', job.status === 'error' ? 'text-soft' : 'text-muted')}>{text}</p>}
      {stages.length > 0 && (
        <ol className="flex flex-wrap gap-1.5">
          {stages.map((s, i) => {
            const done = job.status === 'completed' || i < currentIdx
            const current = active && i === currentIdx
            return (
              <li
                key={s}
                className={cn(
                  'flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]',
                  done ? 'border-line-strong text-soft' : current ? 'border-fg text-fg' : 'border-line text-dim',
                )}
              >
                {done && <Icon as={Check} size={11} />}
                {t(`stage.${s}`)}
              </li>
            )
          })}
        </ol>
      )}
      {job.warning && <p className="border-l-2 border-fg pl-2 text-[12.5px] text-soft">{job.warning}</p>}
      {job.status === 'completed' && job.stats && job.kind === 'process' && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label={t('lesson.original')} value={formatDuration(job.stats.orig_duration_sec ?? 0, lang)} />
          <Stat label={t('lesson.clean')} value={formatDuration(job.stats.clean_duration_sec ?? 0, lang)} />
          <Stat label={t('lesson.saved')} value={`${job.stats.saved_percent ?? 0}%`} />
        </div>
      )}
    </div>
  )
}

const HISTORY_PAGE = 15

/** Every finished job, newest first, a page at a time; kept on disk across restarts. */
export function JobHistoryModal({ close }: { close: () => void }) {
  const { t, lang, toast, confirm } = useUI()
  const [page, setPage] = useState(1)
  const res = useResource(() => api.jobHistory(page, HISTORY_PAGE), [page], { keep: true })
  const data = res.data
  return (
    <Modal
      title={t('jobs.history')}
      description={t('jobs.historyHint')}
      width="md"
      onClose={close}
      footer={
        <>
          <Button
            variant="ghost"
            disabled={!data?.total}
            onClick={async () => {
              if (!(await confirm({ title: t('jobs.clearHistory'), text: t('jobs.clearHistoryText'), danger: true, confirmLabel: t('jobs.clearHistory') }))) return
              await api.clearJobHistory().catch((e: Error) => toast(e.message, 'error'))
              setPage(1)
              await res.reload()
            }}
          >
            {t('jobs.clearHistory')}
          </Button>
          <Button onClick={close}>{t('common.close')}</Button>
        </>
      }
    >
      {!data ? (
        <SkeletonList rows={5} />
      ) : data.total === 0 ? (
        <p className="py-8 text-center text-[13px] text-muted">{t('jobs.historyEmpty')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="divide-y divide-line rounded-xl border border-line">
            {data.items.map((j) => (
              <div key={j.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <StateIcon job={j} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-fg">{j.title || j.id}</span>
                  <span className="block truncate text-[11.5px] text-muted">
                    {t(`job.${j.status ?? 'completed'}`)} · {formatDateTime(j.finished_at ?? j.created_at ?? '', lang)}
                    {j.status === 'error' && j.error ? ` · ${j.error}` : ''}
                  </span>
                </span>
                {j.status === 'completed' && j.lesson_id && (
                  <Link to={`/lessons/${j.lesson_id}/notes`} onClick={close} title={t('studio.openLesson')} className="flex size-7 items-center justify-center rounded-md text-soft hover:bg-hover hover:text-fg">
                    <Icon as={ArrowRight} size={15} />
                  </Link>
                )}
              </div>
            ))}
          </div>
          <Pagination page={data.page} size={data.size} total={data.total} onPage={setPage} />
        </div>
      )}
    </Modal>
  )
}
