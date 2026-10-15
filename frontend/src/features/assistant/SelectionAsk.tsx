import { MessageSquareQuote } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { AnimatePresence, m } from '@/components/motion'
import { pop } from '@/lib/motion'

export const QUOTE_MAX = 1200

/** Select text inside (an answer, the audit) -> a button next to the selection asks the assistant about it. */
export function SelectionAsk({ children, onAsk, className }: { children: ReactNode; onAsk: (quote: string) => void; className?: string }) {
  const { t } = useUI()
  const ref = useRef<HTMLDivElement>(null)
  const [pick, setPick] = useState<{ text: string; x: number; y: number } | null>(null)

  useEffect(() => {
    const read = () => {
      const sel = window.getSelection()
      const text = sel?.toString().trim() ?? ''
      if (!sel || !text || sel.rangeCount === 0 || !ref.current?.contains(sel.anchorNode) || !ref.current.contains(sel.focusNode)) {
        setPick(null)
        return
      }
      const r = sel.getRangeAt(0).getBoundingClientRect()
      setPick({ text: text.slice(0, QUOTE_MAX), x: r.left + r.width / 2, y: r.top })
    }
    const onUp = () => setTimeout(read, 0) // after the browser updates the selection
    const hide = () => setPick(null)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('keyup', onUp)
    window.addEventListener('scroll', hide, true)
    return () => {
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('keyup', onUp)
      window.removeEventListener('scroll', hide, true)
    }
  }, [])

  return (
    <div ref={ref} className={className}>
      {children}
      {createPortal(
        <AnimatePresence>
          {pick && (
            // position on a wrapper: the motion preset owns the button's transform
            <div key="ask" style={{ left: pick.x, top: Math.max(8, pick.y - 40) }} className="fixed z-50 -translate-x-1/2">
              <m.button
                type="button"
                variants={pop}
                initial="hidden"
                animate="show"
                exit="exit"
                onMouseDown={(e) => e.preventDefault()} // keep the selection while clicking
                onClick={() => {
                  onAsk(pick.text)
                  window.getSelection()?.removeAllRanges()
                  setPick(null)
                }}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-fg px-2.5 text-[12.5px] font-medium whitespace-nowrap text-bg shadow-float"
              >
                <Icon as={MessageSquareQuote} size={14} />
                {t('assistant.quote')}
              </m.button>
            </div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  )
}

/** "> quoted text" + the question: how a quote travels to the model and stays readable in the history. */
export function withQuote(quote: string, question: string): string {
  const quoted = quote.split('\n').map((l) => `> ${l}`).join('\n')
  return `${quoted}\n\n${question}`
}
