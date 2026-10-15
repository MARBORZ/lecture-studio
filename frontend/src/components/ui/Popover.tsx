import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, m } from '@/components/motion'
import { cn } from '@/lib/cn'
import { pop } from '@/lib/motion'

/**
 * A panel anchored to its trigger (menus, details). Closes on outside click and Esc.
 * trigger gets {open, toggle}; children get close().
 */
export function Popover({
  trigger,
  children,
  align = 'start',
  side = 'bottom',
  className,
  rootClassName,
}: {
  trigger: (p: { open: boolean; toggle: () => void }) => ReactNode
  children: (close: () => void) => ReactNode
  align?: 'start' | 'end'
  side?: 'bottom' | 'top'
  className?: string
  /** the wrapper around the trigger (e.g. min-w-0 so a truncating trigger can shrink in a flex row) */
  rootClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation() // a dialog or focus mode under it stays as is
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div ref={ref} className={cn('relative', rootClassName)}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      <AnimatePresence>
        {open && (
          <m.div
            variants={pop}
            initial="hidden"
            animate="show"
            exit="exit"
            className={cn(
              'absolute z-30 min-w-56 rounded-xl border border-line-strong bg-raised p-1.5 shadow-float',
              align === 'end' ? 'right-0' : 'left-0',
              side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
              className,
            )}
          >
            {children(() => setOpen(false))}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** A row inside a Popover menu. */
export function MenuItem({ active, className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-hover disabled:pointer-events-none disabled:opacity-40',
        active ? 'text-fg' : 'text-soft',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
