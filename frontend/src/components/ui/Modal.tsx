import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { m } from '@/components/motion'
import { cn } from '@/lib/cn'
import { fade, pop } from '@/lib/motion'
import { IconButton } from './Button'

/** The only modal shell. Esc / backdrop close; focus moves inside on open. */
export function Modal({ title, description, children, footer, onClose, width = 'md' }: { title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; onClose: () => void; width?: 'sm' | 'md' | 'lg' }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    ref.current?.querySelector<HTMLElement>('input, textarea, select, button[data-autofocus]')?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal>
      <m.div variants={fade} initial="hidden" animate="show" exit="exit" className="absolute inset-0 bg-black/75 backdrop-blur-[2px]" onClick={onClose} />
      <m.div
        ref={ref}
        variants={pop}
        initial="hidden"
        animate="show"
        exit="exit"
        className={cn('relative flex max-h-[88vh] w-full flex-col rounded-xl border border-line-strong bg-surface shadow-2xl', { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }[width])}
      >
        <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
          <div>
            <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
            {description && <div className="mt-1 text-[13px] leading-snug text-muted">{description}</div>}
          </div>
          <IconButton icon={X} label="Close" size="sm" onClick={onClose} className="-mr-1.5" />
        </header>
        {children && <div className="scroll-area px-5 pb-4">{children}</div>}
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </m.div>
    </div>
  )
}
