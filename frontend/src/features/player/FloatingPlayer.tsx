/**
 * The detached player.
 *   window — a floating panel inside the app: drag by the header, resize from the corner (16:9 kept),
 *            S/M/L presets, fullscreen. Keeps playing while you move around the app.
 *   pip    — an always-on-top OS window (Document Picture-in-Picture, Chromium) with the same controls;
 *            browsers without it fall back to the native video Picture-in-Picture.
 * Geometry is remembered; the panel never ends up off-screen.
 */
import { ArrowUpRight, Expand, PictureInPicture2, Shrink, Undo2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router'
import { useUI } from '@/app/AppProvider'
import { AnimatePresence, m } from '@/components/motion'
import { IconButton, Segmented } from '@/components/ui'
import { cn } from '@/lib/cn'
import { storage } from '@/lib/format'
import { pop } from '@/lib/motion'
import { PlayerBar, PlayerSurface, usePlayerHotkeys } from './MediaPlayer'
import { player, usePlayer } from './store'

interface Geometry { x: number; y: number; w: number }

const SIZES = { s: 400, m: 640, l: 960 } as const
type SizeKey = keyof typeof SIZES
const MIN_W = 320
const MARGIN = 16
const CHROME_H = 40 + 92 // header + controls under the video

const heightFor = (w: number) => Math.round((w * 9) / 16) + CHROME_H

function clampGeometry(g: Geometry): Geometry {
  const maxW = Math.max(MIN_W, window.innerWidth - MARGIN * 2)
  const w = Math.min(Math.max(g.w, MIN_W), maxW)
  const h = heightFor(w)
  return {
    w,
    x: Math.min(Math.max(g.x, MARGIN), Math.max(MARGIN, window.innerWidth - w - MARGIN)),
    y: Math.min(Math.max(g.y, MARGIN), Math.max(MARGIN, window.innerHeight - h - MARGIN)),
  }
}

function defaultGeometry(w: number = SIZES.m): Geometry {
  return clampGeometry({ w, x: window.innerWidth - w - 24, y: window.innerHeight - heightFor(w) - 24 })
}

// Document Picture-in-Picture is not in the TS DOM lib yet.
type DocumentPip = { requestWindow: (opts: { width: number; height: number }) => Promise<Window> }
const documentPip = (): DocumentPip | undefined => (window as unknown as { documentPictureInPicture?: DocumentPip }).documentPictureInPicture

function copyStyles(target: Document) {
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => target.head.appendChild(node.cloneNode(true)))
  target.documentElement.lang = document.documentElement.lang
  target.body.className = 'bg-bg text-fg font-sans antialiased'
}

export function FloatingPlayer() {
  const display = usePlayer((s) => s.display)
  const lessonId = usePlayer((s) => s.lessonId)
  const [pipWindow, setPipWindow] = useState<Window | null>(null)

  // Leaving "pip" (from any button) closes the OS window; its pagehide handler clears the state.
  useEffect(() => {
    if (display !== 'pip' && pipWindow && !pipWindow.closed) pipWindow.close()
  }, [display, pipWindow])

  usePlayerHotkeys(window, display !== 'inline')
  usePlayerHotkeys(pipWindow, display === 'pip')

  const openPip = useCallback(async () => {
    const api = documentPip()
    if (!api) {
      // Native video PiP: the OS window shows the video; our panel stays as the remote control.
      const el = player.element
      if (el instanceof HTMLVideoElement && document.pictureInPictureEnabled) await el.requestPictureInPicture().catch(() => undefined)
      return
    }
    const g = storage.get<Geometry>('player.window', defaultGeometry())
    const win = await api.requestWindow({ width: g.w, height: heightFor(g.w) - 40 })
    copyStyles(win.document)
    win.addEventListener('pagehide', () => {
      setPipWindow(null)
      if (player.getState().display === 'pip') player.setDisplay('window')
    })
    setPipWindow(win)
    player.setDisplay('pip')
  }, [])

  if (!lessonId) return null
  return (
    <>
      <AnimatePresence>{display === 'window' && <FloatingWindow key="floating" onPip={openPip} />}</AnimatePresence>
      {display === 'pip' && pipWindow && createPortal(<PipContent />, pipWindow.document.body)}
    </>
  )
}

/** Header buttons shared by the floating panel and the OS window. */
function useWindowActions() {
  const lessonId = usePlayer((s) => s.lessonId)
  const { pathname } = useLocation()
  const onLessonPage = Boolean(lessonId && pathname.startsWith(`/lessons/${lessonId}`))
  return {
    onLessonPage,
    // Close: back onto the page if the lesson is open, otherwise stop playback.
    close: () => (onLessonPage ? player.setDisplay('inline') : player.unload()),
  }
}

function FloatingWindow({ onPip }: { onPip: () => void }) {
  const { t } = useUI()
  const navigate = useNavigate()
  const title = usePlayer((s) => s.title)
  const lessonId = usePlayer((s) => s.lessonId)
  const { onLessonPage, close } = useWindowActions()
  const [geom, setGeom] = useState<Geometry>(() => clampGeometry(storage.get<Geometry>('player.window', defaultGeometry())))
  const [fullscreen, setFullscreen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const pipSupported = Boolean(documentPip()) || document.pictureInPictureEnabled

  const commit = useCallback((g: Geometry) => {
    const next = clampGeometry(g)
    setGeom(next)
    storage.set('player.window', next)
  }, [])

  // keep on screen when the browser window changes size
  useEffect(() => {
    const onResize = () => setGeom((g) => clampGeometry(g))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === panelRef.current)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const drag = (mode: 'move' | 'resize') => (e: ReactPointerEvent) => {
    if (fullscreen || (mode === 'move' && (e.target as Element).closest('button'))) return
    e.preventDefault()
    const start = { px: e.clientX, py: e.clientY, ...geom }
    let last = geom
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.px
      const dy = ev.clientY - start.py
      last = clampGeometry(mode === 'move' ? { ...start, x: start.x + dx, y: start.y + dy } : { ...start, w: start.w + dx })
      setGeom(last)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
      commit(last)
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const sizeKey = (Object.keys(SIZES) as SizeKey[]).find((k) => Math.abs(SIZES[k] - geom.w) < 4)

  return (
    <m.div
      ref={panelRef}
      role="dialog"
      aria-label={title}
      variants={pop}
      initial="hidden"
      animate="show"
      exit="exit"
      style={fullscreen ? undefined : { left: geom.x, top: geom.y, width: geom.w }}
      className={cn(
        'fixed z-40 flex flex-col overflow-hidden border border-line-strong bg-surface shadow-[0_24px_80px_rgba(0,0,0,0.7)]',
        fullscreen ? 'inset-0 rounded-none' : 'rounded-2xl',
      )}
    >
      <header onPointerDown={drag('move')} className={cn('flex h-10 shrink-0 items-center gap-1 border-b border-line pr-1.5 pl-3', !fullscreen && 'cursor-grab active:cursor-grabbing')}>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-soft">{title}</span>
        {!fullscreen && (
          <Segmented
            size="sm"
            value={sizeKey ?? ('' as SizeKey)}
            onChange={(k: SizeKey) => commit({ ...geom, w: SIZES[k] })}
            options={[{ value: 's', label: 'S' }, { value: 'm', label: 'M' }, { value: 'l', label: 'L' }]}
          />
        )}
        {!onLessonPage && lessonId && <IconButton icon={ArrowUpRight} size="sm" label={t('player.openLesson')} onClick={() => navigate(`/lessons/${lessonId}/notes`)} />}
        {pipSupported && <IconButton icon={PictureInPicture2} size="sm" label={t('player.pip')} onClick={onPip} />}
        <IconButton
          icon={fullscreen ? Shrink : Expand}
          size="sm"
          label={fullscreen ? t('player.exitFullscreen') : t('player.fullscreen')}
          onClick={() => (fullscreen ? document.exitFullscreen() : panelRef.current?.requestFullscreen())}
        />
        {onLessonPage && <IconButton icon={Undo2} size="sm" label={t('player.dock')} onClick={() => player.setDisplay('inline')} />}
        <IconButton icon={X} size="sm" label={t('player.close')} onClick={close} />
      </header>

      <PlayerSurface className={fullscreen ? 'min-h-0 flex-1' : 'aspect-video'} />
      <div className="shrink-0 px-3 pt-2 pb-3">
        <PlayerBar compact />
      </div>

      {!fullscreen && (
        <span
          onPointerDown={drag('resize')}
          aria-hidden
          className="absolute right-0 bottom-0 size-4 cursor-nwse-resize after:absolute after:right-1 after:bottom-1 after:size-2 after:border-r after:border-b after:border-muted"
        />
      )}
    </m.div>
  )
}

/** Inside the always-on-top OS window: video fills it, controls at the bottom. */
function PipContent() {
  const { t } = useUI()
  const { onLessonPage, close } = useWindowActions()
  return (
    <div className="flex h-screen flex-col bg-bg text-fg">
      <PlayerSurface className="min-h-0 flex-1" />
      <div className="shrink-0 px-3 pt-2 pb-3">
        <PlayerBar
          compact
          extra={
            <>
              <IconButton icon={PictureInPicture2} label={t('player.backToApp')} onClick={() => player.setDisplay('window')} />
              {onLessonPage && <IconButton icon={Undo2} label={t('player.dock')} onClick={() => player.setDisplay('inline')} />}
              <IconButton icon={X} label={t('player.close')} onClick={close} />
            </>
          }
        />
      </div>
    </div>
  )
}
