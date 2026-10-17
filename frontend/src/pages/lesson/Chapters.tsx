import { useMemo } from 'react'
import { type Chapter } from '@/features/player/MediaPlayer'
import { player, usePlayer } from '@/features/player/store'
import { cn } from '@/lib/cn'
import { findActiveIndex, formatTc } from '@/lib/time'

/** The audit's chapters under the player: click to seek, the one playing is lit. */
export function Chapters({ chapters }: { chapters: Chapter[] }) {
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
