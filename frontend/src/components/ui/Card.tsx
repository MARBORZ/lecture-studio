import { ChevronDown, type LucideIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Icon } from '@/components/Icon'
import { AnimatePresence, m } from '@/components/motion'
import { cn } from '@/lib/cn'
import { storage } from '@/lib/format'
import { collapse } from '@/lib/motion'

/**
 * A section of a page. With `fold` (a storage key) it folds to its title and `summary` — the current value in one
 * line — and opens on a click; folded by default, remembered per card. Long settings pages stay a short list.
 */
export function Card({
  title,
  description,
  actions,
  children,
  className,
  padded = true,
  fold,
  summary,
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
  padded?: boolean
  fold?: string
  summary?: ReactNode
}) {
  const key = fold ? `card.open.${fold}` : ''
  const [open, setOpen] = useState(() => !fold || storage.get(key, false))
  const toggle = () =>
    setOpen((v) => {
      storage.set(key, !v)
      return !v
    })
  const head = (
    <>
      <div className="min-w-0 flex-1">
        {title && <h3 className="text-[13.5px] font-semibold text-fg">{title}</h3>}
        {fold && !open && summary ? (
          <p className="mt-0.5 truncate text-[12.5px] text-muted">{summary}</p>
        ) : (
          description && <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{description}</p>
        )}
      </div>
      {fold && <Icon as={ChevronDown} size={15} className={cn('mt-0.5 shrink-0 text-dim transition-transform duration-200', open && 'rotate-180')} />}
    </>
  )
  return (
    <section className={cn('rounded-xl border border-line bg-surface', className)}>
      {(title || actions) && (
        <header className={cn('flex items-start justify-between gap-4 px-5 py-3.5', (open || !fold) && 'border-b border-line')}>
          {fold ? (
            <button type="button" onClick={toggle} aria-expanded={open} className="flex min-w-0 flex-1 items-start gap-4 text-left outline-none">
              {head}
            </button>
          ) : (
            head
          )}
          {actions && (open || !fold) && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      {fold ? (
        <AnimatePresence initial={false}>
          {open && (
            <m.div key="body" variants={collapse} initial="hidden" animate="show" exit="exit" className="overflow-hidden">
              <div className={cn(padded && 'p-5')}>{children}</div>
            </m.div>
          )}
        </AnimatePresence>
      ) : (
        <div className={cn(padded && 'p-5')}>{children}</div>
      )}
    </section>
  )
}

export function EmptyState({ icon, title, hint, action }: { icon: LucideIcon; title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="flex size-11 items-center justify-center rounded-full border border-line text-muted">
        <Icon as={icon} size={19} />
      </span>
      <div>
        <p className="text-[14px] font-medium text-fg">{title}</p>
        {hint && <p className="mx-auto mt-1 max-w-sm text-[13px] leading-snug text-muted">{hint}</p>}
      </div>
      {action}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions, eyebrow, cover }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; cover?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="flex min-w-0 items-center gap-4">
      {cover}
      <div className="min-w-0">
        {eyebrow && <div className="label-caps mb-2">{eyebrow}</div>}
        <h1 className="truncate text-[22px] font-semibold tracking-[-0.02em] text-fg">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-[13.5px] leading-snug text-muted">{subtitle}</p>}
      </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/** Thin monochrome progress bar. */
export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-[3px] w-full overflow-hidden rounded-full bg-line', className)}>
      {/* scaleX, not width: runs on the compositor, no page re-layout while it moves */}
      <div
        className="h-full origin-left rounded-full bg-fg transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{ transform: `scaleX(${Math.max(0, Math.min(100, value)) / 100})` }}
      />
    </div>
  )
}

/** Small mono key/value used in stats rows. */
export function Stat({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="label-caps">{label}</span>
      <span className="font-mono text-[13px] text-fg">{value}</span>
    </div>
  )
}

/** Standard scrollable page body with a centred column. */
export function Page({ children, width = 'md', className }: { children: ReactNode; width?: 'md' | 'lg' | 'full'; className?: string }) {
  return (
    <div className="scroll-area h-full">
      <div className={cn('mx-auto px-6 py-8 lg:px-10', { md: 'max-w-4xl', lg: 'max-w-6xl', full: 'max-w-none' }[width], className)}>{children}</div>
    </div>
  )
}
