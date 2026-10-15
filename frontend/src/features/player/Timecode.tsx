import { useNavigate } from 'react-router'
import { useLibrary } from '@/app/AppProvider'
import { formatTc } from '@/lib/time'
import { cn } from '@/lib/cn'
import { player, usePlayer } from './store'

/**
 * The only timecode chip. Same lesson -> seek the player. Another lesson (notebook citation)
 * -> open that lesson at the moment via ?t=.
 */
export function Timecode({ seconds, lessonId, className }: { seconds: number; lessonId?: string; className?: string }) {
  const navigate = useNavigate()
  const { lessons } = useLibrary()
  const current = usePlayer((s) => s.lessonId)
  const external = Boolean(lessonId && lessonId !== current)
  const title = external ? lessons.find((l) => l.id === lessonId)?.title : undefined

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        if (external) navigate(`/lessons/${lessonId}/notes?t=${Math.floor(seconds)}`)
        else player.seek(seconds, true)
      }}
      title={title ? `${title} · ${formatTc(seconds)}` : formatTc(seconds)}
      className={cn(
        'mx-[1px] inline-flex translate-y-[-1px] items-center gap-1 rounded-[5px] border border-line-strong bg-raised px-1.5 align-middle font-mono text-[11.5px] leading-[18px] text-fg transition-colors hover:border-fg hover:bg-fg hover:text-bg',
        className,
      )}
    >
      {title && <span className="max-w-[14ch] truncate font-sans">{title}</span>}
      {formatTc(seconds)}
    </button>
  )
}
