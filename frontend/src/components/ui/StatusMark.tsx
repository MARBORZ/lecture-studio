import type { LessonStatus } from '@/api/types'
import { cn } from '@/lib/cn'

/** Status by shape, not color: ring = studying, half = review, filled = done. */
export function StatusMark({ status, className }: { status: LessonStatus; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-2.5 shrink-0 rounded-full border border-fg',
        status === 'completed' && 'bg-fg',
        status === 'to_review' && 'bg-[linear-gradient(90deg,var(--color-fg)_50%,transparent_50%)]',
        className,
      )}
    />
  )
}
