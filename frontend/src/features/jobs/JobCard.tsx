import { ArrowRight, Check, X } from 'lucide-react'
import { Link } from 'react-router'
import { api } from '@/api/client'
import type { Job } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Button, Progress, Stat } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatDuration } from '@/lib/format'

export function JobCard({ job }: { job: Job }) {
  const { t, toast, lang } = useUI()
  const active = job.status === 'pending' || job.status === 'processing'
  const stages = job.stages ?? []
  const currentIdx = stages.indexOf(job.stage ?? 'queued')

  return (
    <article className={cn('rounded-xl border bg-surface p-4', active ? 'border-line-strong' : 'border-line')}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[14px] font-medium text-fg">{job.title || job.id}</h3>
          <p className="mt-0.5 truncate text-[12.5px] text-muted">{job.status === 'error' ? job.error : job.message}</p>
        </div>
        <span className="shrink-0 font-mono text-[12px] text-fg">{active ? `${job.progress}%` : t(`job.${job.status ?? 'pending'}`)}</span>
      </header>

      {active && <Progress value={job.progress ?? 0} className="mt-3" />}

      {stages.length > 0 && (
        <ol className="mt-3 flex flex-wrap gap-1.5">
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
                {current && <span className="size-1.5 animate-pulse-soft rounded-full bg-fg" />}
                {t(`stage.${s}`)}
              </li>
            )
          })}
        </ol>
      )}

      {job.warning && <p className="mt-3 border-l-2 border-fg pl-2 text-[12.5px] text-soft">{job.warning}</p>}

      {job.status === 'completed' && job.stats && job.kind === 'process' && (
        <div className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3">
          <Stat label={t('lesson.original')} value={formatDuration(job.stats.orig_duration_sec ?? 0, lang)} />
          <Stat label={t('lesson.clean')} value={formatDuration(job.stats.clean_duration_sec ?? 0, lang)} />
          <Stat label={t('lesson.saved')} value={`${job.stats.saved_percent ?? 0}%`} />
        </div>
      )}

      {(active || (job.status === 'completed' && job.lesson_id)) && (
        <footer className="mt-4 flex justify-end">
          {active ? (
            <Button
              size="sm"
              variant="ghost"
              icon={X}
              disabled={job.cancel_requested}
              onClick={() => api.cancelJob(job.id).catch((e) => toast(e.message, 'error'))}
            >
              {t('studio.cancelJob')}
            </Button>
          ) : (
            <Link to={`/lessons/${job.lesson_id}/notes`}>
              <Button size="sm" variant="primary" iconRight={ArrowRight}>{t('studio.openLesson')}</Button>
            </Link>
          )}
        </footer>
      )}
    </article>
  )
}
