import { AudioLines, Maximize2, Minimize2, Pause, Play, RotateCcw, RotateCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Button, IconButton, Segmented } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatTc } from '@/lib/time'
import { player, usePlayer } from './store'
import { isTyping } from '@/lib/keys'

export interface Chapter { t: number; title: string }

/** One player for the clean timeline: video or audio element, shared controls, chapter markers. */
export function MediaPlayer({ chapters = [], compact = false }: { chapters?: Chapter[]; compact?: boolean }) {
  const { t, focusMode, setFocusMode } = useUI()
  const mode = usePlayer((s) => s.mode)
  const audioUrl = usePlayer((s) => s.audioUrl)
  const videoUrl = usePlayer((s) => s.videoUrl)
  const playing = usePlayer((s) => s.playing)
  const rate = usePlayer((s) => s.rate)

  const ref = useCallback((el: HTMLMediaElement | null) => player.attach(el), [])
  const src = mode === 'video' ? videoUrl : audioUrl

  useHotkeys()

  if (!audioUrl && !videoUrl) {
    return <div className="flex aspect-video items-center justify-center rounded-xl border border-line text-[13px] text-muted">{t('player.noMedia')}</div>
  }

  const events = {
    onTimeUpdate: (e: React.SyntheticEvent<HTMLMediaElement>) => player.onTime(e.currentTarget),
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLMediaElement>) => player.onDuration(e.currentTarget),
    onDurationChange: (e: React.SyntheticEvent<HTMLMediaElement>) => player.onDuration(e.currentTarget),
    onPlay: () => player.onPlaying(true),
    onPause: () => player.onPlaying(false),
    onEnded: () => player.onPlaying(false),
  }

  return (
    <div className="flex flex-col gap-3">
      {mode === 'video' && videoUrl ? (
        <video
          key={src}
          ref={ref}
          src={src ?? undefined}
          preload="metadata"
          playsInline
          onClick={() => player.toggle()}
          className={cn('w-full cursor-pointer rounded-xl border border-line bg-black object-contain', compact ? 'max-h-[34vh]' : 'aspect-video')}
          {...events}
        />
      ) : (
        <audio key={src} ref={ref} src={src ?? undefined} preload="metadata" className="hidden" {...events} />
      )}

      <Timeline chapters={chapters} />

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => player.toggle()}
          aria-label={playing ? 'Pause' : 'Play'}
          className="flex size-9 items-center justify-center rounded-full bg-fg text-bg transition-transform hover:scale-105"
        >
          <Icon as={playing ? Pause : Play} size={16} fill="currentColor" strokeWidth={0} className={playing ? '' : 'translate-x-[1px]'} />
        </button>
        <IconButton icon={RotateCcw} label="−5 s" onClick={() => player.skip(-5)} />
        <IconButton icon={RotateCw} label="+5 s" onClick={() => player.skip(5)} />
        <TimeReadout />
        <div className="flex-1" />
        <Button
          title={t('player.speed')}
          onClick={() => {
            const i = player.rates.indexOf(rate as (typeof player.rates)[number])
            player.setRate(player.rates[(i + 1) % player.rates.length])
          }}
          className="w-14 px-0 font-mono text-[12.5px]"
        >
          {rate}×
        </Button>
        {videoUrl && (
          <Segmented
            size="md"
            value={mode}
            onChange={(m) => player.setMode(m)}
            options={[
              { value: 'video', label: t('player.video') },
              { value: 'audio', label: t('player.audio') },
            ]}
          />
        )}
        {!videoUrl && <Icon as={AudioLines} size={16} className="text-muted" />}
        <IconButton
          icon={focusMode ? Minimize2 : Maximize2}
          label={focusMode ? t('player.unfocus') : t('player.focus')}
          active={focusMode}
          onClick={() => setFocusMode((v) => !v)}
        />
      </div>
    </div>
  )
}

function TimeReadout() {
  const current = usePlayer((s) => Math.floor(s.currentTime))
  const duration = usePlayer((s) => Math.floor(s.duration))
  return (
    <span className="ml-1 font-mono text-[12px] text-muted tabular-nums">
      <span className="text-fg">{formatTc(current)}</span> / {formatTc(duration)}
    </span>
  )
}

function Timeline({ chapters }: { chapters: Chapter[] }) {
  const current = usePlayer((s) => s.currentTime)
  const duration = usePlayer((s) => s.duration)
  const [hover, setHover] = useState<{ x: number; t: number; w: number } | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  const timeAt = (clientX: number) => {
    const rect = barRef.current!.getBoundingClientRect()
    const f = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return { x: f * rect.width, t: f * duration, w: rect.width }
  }
  const chapterAt = useMemo(() => (t: number) => [...chapters].reverse().find((c) => c.t <= t), [chapters])

  const pct = duration ? (current / duration) * 100 : 0
  return (
    <div
      ref={barRef}
      className="group relative h-4 cursor-pointer select-none"
      onMouseMove={(e) => duration && setHover(timeAt(e.clientX))}
      onMouseLeave={() => setHover(null)}
      onClick={(e) => duration && player.seek(timeAt(e.clientX).t, true)}
    >
      <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-line group-hover:h-[5px]" />
      <div className="absolute top-1/2 left-0 h-[3px] -translate-y-1/2 rounded-full bg-fg group-hover:h-[5px]" style={{ width: `${pct}%` }} />
      {duration > 0 && chapters.map((c) => (
        <span key={c.t} className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-muted" style={{ left: `${(c.t / duration) * 100}%` }} />
      ))}
      <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg opacity-0 group-hover:opacity-100" style={{ left: `${pct}%` }} />
      {hover && (
        <span
          className="pointer-events-none absolute bottom-5 -translate-x-1/2 rounded-md border border-line-strong bg-raised px-2 py-1 text-[11.5px] whitespace-nowrap text-fg shadow-lg"
          style={{ left: Math.max(40, Math.min(hover.x, hover.w - 40)) }}
        >
          <span className="font-mono">{formatTc(hover.t)}</span>
          {chapterAt(hover.t) && <span className="ml-2 text-muted">{chapterAt(hover.t)!.title}</span>}
        </span>
      )}
    </div>
  )
}

/** Space = play/pause, ←/→ = ∓5 s, outside text inputs. */
function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.code === 'Space') {
        e.preventDefault()
        player.toggle()
      } else if (e.code === 'ArrowLeft') player.skip(-5)
      else if (e.code === 'ArrowRight') player.skip(5)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
