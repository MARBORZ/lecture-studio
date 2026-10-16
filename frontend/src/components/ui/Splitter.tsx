import { useRef, type RefObject } from 'react'
import { cn } from '@/lib/cn'

/**
 * Vertical drag handle that sets the width (in % of a container) of the panel to its left.
 * Drag with the mouse, ←/→ with the keyboard, double-click to reset.
 */
export function Splitter({
  containerRef,
  value,
  onChange,
  onCommit,
  onReset,
  onDragging,
  min = 25,
  max = 75,
  label,
  className,
}: {
  containerRef: RefObject<HTMLElement | null>
  value: number
  onChange: (pct: number) => void
  onCommit?: (pct: number) => void
  onReset?: () => void
  onDragging?: (dragging: boolean) => void // the panel follows the pointer at once while true (no width animation)
  min?: number
  max?: number
  label: string
  className?: string
}) {
  const latest = useRef(value)
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  const set = (v: number) => {
    latest.current = clamp(v)
    onChange(latest.current)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={label}
      onPointerDown={(e) => {
        const rect = containerRef.current?.getBoundingClientRect()
        if (!rect) return
        e.currentTarget.setPointerCapture(e.pointerId)
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'col-resize'
        onDragging?.(true)
        const move = (ev: PointerEvent) => set(((ev.clientX - rect.left) / rect.width) * 100)
        const up = () => {
          document.body.style.userSelect = ''
          document.body.style.cursor = ''
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          onDragging?.(false)
          onCommit?.(latest.current)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          set(value + (e.key === 'ArrowLeft' ? -2 : 2))
          onCommit?.(latest.current)
        }
      }}
      className={cn('group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize touch-none focus:outline-none', className)}
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line transition-colors group-hover:bg-line-strong group-focus-visible:bg-fg group-active:bg-fg" />
      <span className="absolute top-1/2 left-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-line-strong opacity-0 transition-opacity group-hover:opacity-100 group-active:opacity-100" />
    </div>
  )
}
