import { AudioLines, FileText, ScrollText, Video } from 'lucide-react'
import { memo } from 'react'
import { Link } from 'react-router'
import type { Lesson } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { StatusMark } from '@/components/ui'
import { formatDate, formatDuration } from '@/lib/format'

export const LessonRow = memo(function LessonRow({ lesson, notebook }: { lesson: Lesson; notebook?: string }) {
  const { t, lang } = useUI()
  const flags = [
    lesson.has_video && { icon: Video, label: t('player.video') },
    !lesson.has_video && { icon: AudioLines, label: t('player.audio') },
    lesson.has_transcription && { icon: ScrollText, label: t('lesson.transcript') },
    lesson.has_audit && { icon: FileText, label: t('lesson.notes') },
  ].filter(Boolean) as Array<{ icon: typeof Video; label: string }>

  return (
    <Link
      to={`/lessons/${lesson.id}/notes`}
      className="group grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-surface sm:grid-cols-[auto_1fr_auto_auto_auto]"
    >
      <span title={t(`status.${lesson.status ?? 'in_progress'}`)}>
        <StatusMark status={lesson.status ?? 'in_progress'} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[14px] text-fg">{lesson.title}</span>
        <span className="block truncate text-[12px] text-muted">
          {notebook && <>{notebook} · </>}
          {formatDate(lesson.created_at ?? '', lang)}
        </span>
      </span>
      <span className="hidden items-center gap-1.5 text-dim sm:flex">
        {flags.map((f) => (
          <span key={f.label} title={f.label}>
            <Icon as={f.icon} size={14} />
          </span>
        ))}
      </span>
      <span className="hidden w-20 text-right font-mono text-[12px] text-soft sm:block">{formatDuration(lesson.clean_duration_sec ?? 0, lang)}</span>
      <span className="w-14 text-right font-mono text-[12px] text-muted">−{Math.round(lesson.saved_percent ?? 0)}%</span>
    </Link>
  )
})
