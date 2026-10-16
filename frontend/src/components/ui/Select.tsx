import { Check, ChevronDown, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/Icon'
import { AnimatePresence, m } from '@/components/motion'
import { cn } from '@/lib/cn'
import { pop } from '@/lib/motion'

export interface Option<V extends string = string> {
  value: V
  label: string
  /** a second line or a quiet note after the label */
  hint?: string
  icon?: LucideIcon
  disabled?: boolean
}

/** Room kept between the list and the window edge; the list opens upward when there is less below. */
const EDGE = 12
const MAX_H = 320

/**
 * The one dropdown of the app, drawn by us instead of the browser's <select>: the trigger looks like the other
 * fields, the list fades and slides in (lib/motion `pop`), scrolls without a visible bar and has no focus rings —
 * the highlighted row is the state. It lives in a portal with fixed position, so no card or dialog clips it.
 * Keys: ↑/↓ move, Enter/Space pick, Esc/Tab close, typing jumps to a matching label.
 */
export function Select<V extends string>({
  options,
  value,
  onChange,
  className,
  disabled,
  placeholder,
  size = 'md',
  renderValue,
  'aria-label': ariaLabel,
}: {
  options: Option<V>[]
  value: V
  onChange: (v: V) => void
  className?: string
  disabled?: boolean
  placeholder?: string
  size?: 'sm' | 'md'
  /** what the closed field shows (default: the option's label) */
  renderValue?: (option: Option<V> | undefined) => ReactNode
  'aria-label'?: string
}) {
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [place, setPlace] = useState<{ left: number; width: number; top?: number; bottom?: number; maxH: number } | null>(null)
  const typed = useRef({ text: '', at: 0 })
  const current = options.find((o) => o.value === value)

  const measure = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect()
    if (!r) return
    const below = window.innerHeight - r.bottom - EDGE
    const above = r.top - EDGE
    const up = below < Math.min(MAX_H, options.length * 36 + 12) && above > below
    const width = Math.max(r.width, 180)
    const left = Math.min(r.left, window.innerWidth - width - EDGE)
    setPlace(up ? { left, width, bottom: window.innerHeight - r.top + 6, maxH: Math.min(MAX_H, above - 6) } : { left, width, top: r.bottom + 6, maxH: Math.min(MAX_H, below - 6) })
  }, [options.length])

  const openList = () => {
    if (disabled) return
    measure()
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }
  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus({ preventScroll: true })
  }
  const pick = (i: number) => {
    const o = options[i]
    if (!o || o.disabled) return
    if (o.value !== value) onChange(o.value)
    close()
  }
  const move = (from: number, step: number) => {
    for (let k = 1; k <= options.length; k++) {
      const i = (from + step * k + options.length * k) % options.length
      if (!options[i].disabled) return i
    }
    return from
  }

  // follow the trigger while open (scrolling the page, resizing the window)
  useLayoutEffect(() => {
    if (!open) return
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, measure])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!listRef.current?.contains(t) && !triggerRef.current?.contains(t)) close(false)
    }
    // Esc closes it wherever the focus is (opened by mouse, the focus may be elsewhere)
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
    }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onEsc, true)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onEsc, true)
    }
  })

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        openList()
      }
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => move(i, e.key === 'ArrowDown' ? 1 : -1))
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      setActive(e.key === 'Home' ? move(-1, 1) : move(options.length, -1))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(active)
    } else if (e.key === 'Tab') {
      close(false)
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      const now = Date.now()
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now }
      const hit = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(typed.current.text))
      if (hit >= 0) setActive(hit)
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={id}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        className={cn(
          'flex items-center gap-2 rounded-[var(--radius-ui)] border bg-surface px-3 text-left text-[13.5px] text-fg outline-none transition-colors disabled:opacity-50',
          size === 'sm' ? 'h-7 text-[12.5px]' : 'h-9',
          open ? 'border-fg' : 'border-line hover:border-line-strong',
          !/(^|\s)w-/.test(className ?? '') && 'w-full', // a field fills its column unless given a width
          className,
        )}
      >
        {current?.icon && <Icon as={current.icon} size={14} className="shrink-0 text-muted" />}
        <span className={cn('min-w-0 flex-1 truncate', !current && 'text-dim')}>
          {renderValue ? renderValue(current) : current?.label ?? placeholder ?? ''}
        </span>
        <Icon as={ChevronDown} size={14} className={cn('shrink-0 text-muted transition-transform duration-200', open && 'rotate-180')} />
      </button>
      {createPortal(
        <AnimatePresence>
          {open && place && (
            <m.div
              key="list"
              ref={listRef}
              id={id}
              role="listbox"
              variants={pop}
              initial="hidden"
              animate="show"
              exit="exit"
              onKeyDown={onKeyDown}
              style={{ position: 'fixed', left: place.left, width: place.width, top: place.top, bottom: place.bottom, maxHeight: place.maxH }}
              className="scroll-hidden z-[300] flex flex-col rounded-xl border border-line-strong bg-raised p-1 shadow-float outline-none"
            >
              {options.map((o, i) => {
                const selected = o.value === value
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-i={i}
                    tabIndex={-1}
                    disabled={o.disabled}
                    onMouseEnter={() => !o.disabled && setActive(i)}
                    onMouseDown={(e) => e.preventDefault()} // keep the focus on the trigger
                    onClick={() => pick(i)}
                    className={cn(
                      'flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] outline-none transition-colors duration-100 disabled:opacity-40',
                      i === active ? 'bg-hover text-fg' : selected ? 'text-fg' : 'text-soft',
                    )}
                  >
                    {o.icon && <Icon as={o.icon} size={14} className="shrink-0 text-muted" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{o.label}</span>
                      {o.hint && <span className="block truncate text-[11.5px] text-dim">{o.hint}</span>}
                    </span>
                    <Icon as={Check} size={14} className={cn('shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
                  </button>
                )
              })}
            </m.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
