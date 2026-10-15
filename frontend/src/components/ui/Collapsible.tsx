import { ChevronRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Icon } from '@/components/Icon'
import { AnimatePresence, m } from '@/components/motion'
import { cn } from '@/lib/cn'
import { storage } from '@/lib/format'
import { collapse } from '@/lib/motion'

/** A titled section that folds away; the open/closed state is remembered per `id`. */
export function Collapsible({ id, title, extra, defaultOpen = true, children }: { id: string; title: ReactNode; extra?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const key = `section.${id}`
  const [open, setOpen] = useState(() => storage.get(key, defaultOpen))
  const toggle = () => {
    setOpen(!open)
    storage.set(key, !open)
  }
  return (
    <section className="shrink-0">
      <div className="mb-1 flex items-center gap-1">
        <button type="button" onClick={toggle} aria-expanded={open} className="label-caps -ml-1 flex flex-1 items-center gap-1 rounded-md py-1 pl-1 text-left hover:text-fg">
          <Icon as={ChevronRight} size={13} className={cn('transition-transform duration-200', open && 'rotate-90')} />
          {title}
        </button>
        {extra}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <m.div key="body" variants={collapse} initial="hidden" animate="show" exit="exit" className="overflow-hidden">
            {children}
          </m.div>
        )}
      </AnimatePresence>
    </section>
  )
}
