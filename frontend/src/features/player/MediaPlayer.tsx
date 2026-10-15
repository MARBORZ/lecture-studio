import { AudioLines, Expand, Maximize2, Minimize2, Pause, PictureInPicture2, Play, RotateCcw, RotateCw, Shrink, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Button, IconButton, Segmented } from '@/components/ui'
import { cn } from '@/lib/cn'
import { isTyping } from '@/lib/keys'
import { formatTc } from '@/lib/time'
import { BookmarkButton, useBookmarks } from './bookmarks'
import { mediaEvents, player, useMediaRef, usePlayer, type Chapter } from './store'

export type { Chapter }

// ---------------------------------------------------------------- shared parts

/** The media element itself. Rendered by exactly one place at a time (page, floating window or OS window). */
export function PlayerSurface({ className }: { className?: string }) {
  const mode = usePlayer((s) => s.mode)
  const audioUrl = usePlayer((s) => s.audioUrl)
  const videoUrl = usePlayer((s) => s.videoUrl)
  const ref = useMediaRef()
  const src = mode === 'video' ? videoUrl : audioUrl

  if (mode === 'video' && videoUrl) {
    return (
      <video
        key={src}
        ref={ref}
        src={src ?? undefined}
        preload="metadata"
        playsInline
        onClick={() => player.toggle()}
        className={cn('w-full cursor-pointer bg-black object-contain', className)}
        {...mediaEvents}
      />
    )
  }
  return <audio key={src} ref={ref} src={src ?? undefined} preload="metadata" className="hidden" {...mediaEvents} />
}

/**
 * Timeline + transport. `extra` = buttons that depend on where the player is (page or window).
 * marks = the "add a mark" button (off in the OS window: its name dialog lives in the app window).
 */
export function PlayerBar({ extra, compact = false, marks = true }: { extra?: ReactNode; compact?: boolean; marks?: boolean }) {
  const { t } = useUI()
  const mode = usePlayer((s) => s.mode)
  const videoUrl = usePlayer((s) => s.videoUrl)
  const playing = usePlayer((s) => s.playing)
  const rate = usePlayer((s) => s.rate)
  const display = usePlayer((s) => s.display)

  return (
    <div className="flex flex-col gap-3">
      <Timeline />
      {/* two groups: transport left, the rest right. In a narrow column (container < 28rem) they become two full rows. */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
        <div className="flex items-center gap-1.5 @max-md:w-full">
        <button
          type="button"
          onClick={() => player.toggle()}
          aria-label={playing ? 'Pause' : 'Play'}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-fg text-bg transition-transform hover:scale-105"
        >
          <Icon as={playing ? Pause : Play} size={16} fill="currentColor" strokeWidth={0} className={playing ? '' : 'translate-x-[1px]'} />
        </button>
        <IconButton icon={RotateCcw} label="−5 s" onClick={() => player.skip(-5)} />
        <IconButton icon={RotateCw} label="+5 s" onClick={() => player.skip(5)} />
        <TimeReadout />
        </div>
        <div className="ml-auto flex items-center gap-1.5 @max-md:ml-0 @max-md:w-full @max-md:justify-between">
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
        {/* audio/video switch only makes sense on the page; a window always shows video */}
        {videoUrl && display === 'inline' && !compact && (
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
        {marks && <BookmarkButton />}
        {extra}
        </div>
      </div>
    </div>
  )
}

function TimeReadout() {
  const current = usePlayer((s) => Math.floor(s.currentTime))
  const duration = usePlayer((s) => Math.floor(s.duration))
  return (
    <span className="ml-1 font-mono text-[12px] whitespace-nowrap text-muted tabular-nums">
      <span className="text-fg">{formatTc(current)}</span> / {formatTc(duration)}
    </span>
  )
}

function Timeline() {
  const current = usePlayer((s) => s.currentTime)
  const duration = usePlayer((s) => s.duration)
  const chapters = usePlayer((s) => s.chapters)
  const bookmarks = usePlayer((s) => s.bookmarks)
  const [hover, setHover] = useState<{ x: number; t: number; w: number } | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  const timeAt = (clientX: number) => {
    const rect = barRef.current!.getBoundingClientRect()
    const f = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return { x: f * rect.width, t: f * duration, w: rect.width }
  }
  const chapterAt = useMemo(() => (t: number) => [...chapters].reverse().find((c) => c.t <= t), [chapters])
  // a mark within ~1% of the bar under the cursor wins the tooltip
  const nearMark = (t: number) => bookmarks.find((b) => Math.abs(b.t - t) < Math.max(2, duration * 0.01))

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
      {duration > 0 && bookmarks.map((b) => (
        <button
          key={b.id}
          type="button"
          title={`${formatTc(b.t)} ${b.label}`}
          aria-label={b.label}
          onClick={(e) => {
            e.stopPropagation()
            player.seek(b.t, true)
          }}
          className="absolute -top-1 z-10 size-2 -translate-x-1/2 rotate-45 border border-bg bg-fg transition-transform hover:scale-150"
          style={{ left: `${(b.t / duration) * 100}%` }}
        />
      ))}
      <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg opacity-0 group-hover:opacity-100" style={{ left: `${pct}%` }} />
      {hover && (
        <span
          className="pointer-events-none absolute bottom-5 -translate-x-1/2 rounded-md border border-line-strong bg-raised px-2 py-1 text-[11.5px] whitespace-nowrap text-fg shadow-lg"
          style={{ left: Math.max(40, Math.min(hover.x, hover.w - 40)) }}
        >
          <span className="font-mono">{formatTc(hover.t)}</span>
          {nearMark(hover.t) ? (
            <span className="ml-2 text-fg">{nearMark(hover.t)!.label}</span>
          ) : (
            chapterAt(hover.t) && <span className="ml-2 text-muted">{chapterAt(hover.t)!.title}</span>
          )}
        </span>
      )}
    </div>
  )
}

/**
 * Space = play/pause, ←/→ = ∓5 s, M = add a mark, outside text inputs. `target` = which window listens
 * (the main window, or the always-on-top OS window when the player lives there).
 */
export function usePlayerHotkeys(target: Window | null, enabled = true) {
  const { add } = useBookmarks()
  const addRef = useRef(add)
  useEffect(() => {
    addRef.current = add
  })
  useEffect(() => {
    if (!target || !enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.code === 'KeyM' && target === window && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
        e.preventDefault()
        void addRef.current()
      } else if (e.code === 'Space') {
        e.preventDefault()
        player.toggle()
      } else if (e.code === 'ArrowLeft') player.skip(-5)
      else if (e.code === 'ArrowRight') player.skip(5)
    }
    target.addEventListener('keydown', onKey)
    return () => target.removeEventListener('keydown', onKey)
  }, [target, enabled])
}

// ---------------------------------------------------------------- page player

/** The lesson-page player. When the video is out in a window, the page keeps the controls and shows a placeholder. */
export function MediaPlayer() {
  const { t, focusMode, setFocusMode } = useUI()
  const audioUrl = usePlayer((s) => s.audioUrl)
  const videoUrl = usePlayer((s) => s.videoUrl)
  const display = usePlayer((s) => s.display)

  // hotkeys belong to the page only while the video is on the page; a window binds its own
  usePlayerHotkeys(window, display === 'inline')
  const boxRef = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === boxRef.current)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  if (!audioUrl && !videoUrl) {
    return <div className="flex aspect-video items-center justify-center rounded-xl border border-line text-[13px] text-muted">{t('player.noMedia')}</div>
  }

  return (
    <div ref={boxRef} className={cn('flex flex-col gap-3', fullscreen && 'h-full bg-bg p-6')}>
      {display === 'inline' ? (
        <PlayerSurface className={fullscreen ? 'min-h-0 flex-1' : 'aspect-video rounded-xl border border-line'} />
      ) : (
        <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line-strong text-center">
          <Icon as={PictureInPicture2} size={22} className="text-muted" />
          <p className="text-[13px] text-soft">{t('player.inWindow')}</p>
          <Button size="sm" icon={Undo2} onClick={() => player.setDisplay('inline')}>{t('player.dock')}</Button>
        </div>
      )}
      <PlayerBar
        extra={
          <>
            {videoUrl && display === 'inline' && (
              <>
                <IconButton icon={PictureInPicture2} label={t('player.popout')} onClick={() => player.setDisplay('window')} />
                <IconButton
                  icon={fullscreen ? Shrink : Expand}
                  label={fullscreen ? t('player.exitFullscreen') : t('player.fullscreen')}
                  onClick={() => (fullscreen ? document.exitFullscreen() : boxRef.current?.requestFullscreen())}
                />
              </>
            )}
            <IconButton
              icon={focusMode ? Minimize2 : Maximize2}
              label={focusMode ? t('player.unfocus') : t('player.focus')}
              active={focusMode}
              onClick={() => setFocusMode((v) => !v)}
            />
          </>
        }
      />
    </div>
  )
}
