import { Crosshair, Search } from 'lucide-react'
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { Segment } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { player, usePlayer } from '@/features/player/store'
import { cn } from '@/lib/cn'
import { storage } from '@/lib/format'
import { findActiveIndex, formatTc } from '@/lib/time'

/**
 * Transcript on the clean timeline. The active phrase follows the player;
 * click a phrase to seek. Manual scrolling pauses follow for a few seconds.
 */
export function TranscriptView({ segments }: { segments: Segment[] }) {
  const { t } = useUI()
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query.trim().toLowerCase())
  const [follow, setFollow] = useState(() => storage.get('transcript.follow', true))
  const listRef = useRef<HTMLDivElement>(null)
  const userScrollUntil = useRef(0)

  const starts = useMemo(() => segments.map((s) => s.clean_start), [segments])
  const active = usePlayer((s) => findActiveIndex(starts, s.currentTime + 0.05))
  const visible = useMemo(
    () => segments.map((s, i) => ({ s, i })).filter(({ s }) => !deferred || s.text.toLowerCase().includes(deferred)),
    [segments, deferred],
  )

  useEffect(() => {
    if (!follow || deferred || active < 0 || Date.now() < userScrollUntil.current) return
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [active, follow, deferred])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 pb-3">
        <div className="relative flex-1">
          <Icon as={Search} size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-dim" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('common.search')}
            className="h-8 w-full rounded-lg border border-line bg-surface pr-3 pl-8 text-[13px] text-fg placeholder:text-dim focus:border-fg focus:outline-none"
          />
        </div>
        {deferred && <span className="font-mono text-[12px] text-muted">{visible.length}</span>}
        <button
          type="button"
          onClick={() => {
            storage.set('transcript.follow', !follow)
            setFollow(!follow)
          }}
          title={t('lesson.follow')}
          className={cn('flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px]', follow ? 'border-fg text-fg' : 'border-line text-muted hover:text-fg')}
        >
          <Icon as={Crosshair} size={13} />
          {t('lesson.follow')}
        </button>
      </div>

      <div
        ref={listRef}
        onWheel={() => (userScrollUntil.current = Date.now() + 4000)}
        onTouchMove={() => (userScrollUntil.current = Date.now() + 4000)}
        className="scroll-area -mx-2 flex-1"
      >
        {visible.map(({ s, i }) => (
          <Row key={i} index={i} segment={s} active={i === active} query={deferred} origLabel={t('lesson.origTime')} />
        ))}
      </div>
    </div>
  )
}

const Row = memo(function Row({ index, segment, active, query, origLabel }: { index: number; segment: Segment; active: boolean; query: string; origLabel: string }) {
  return (
    <div
      data-i={index}
      onClick={() => player.seek(segment.clean_start, true)}
      className={cn(
        'read-14 group flex cursor-pointer gap-3 rounded-lg px-2 py-1.5 leading-relaxed transition-colors',
        active ? 'bg-raised text-fg' : 'text-muted hover:bg-surface hover:text-soft',
      )}
    >
      <span
        title={`${origLabel}: ${formatTc(segment.orig_start)}`}
        className={cn('w-12 shrink-0 pt-[3px] font-mono text-[11.5px] tabular-nums', active ? 'text-fg' : 'text-dim group-hover:text-muted')}
      >
        {formatTc(segment.clean_start)}
      </span>
      <span className="min-w-0">{query ? highlight(segment.text, query) : segment.text}</span>
    </div>
  )
})

function highlight(text: string, q: string) {
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return parts.map((p, i) => (p.toLowerCase() === q ? <mark key={i} className="rounded-sm bg-fg px-0.5 text-bg">{p}</mark> : p))
}
