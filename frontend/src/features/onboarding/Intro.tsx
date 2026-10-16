import { useEffect } from 'react'
import { m } from '@/components/motion'
import { ease, fadeUp } from '@/lib/motion'

/** How long the intro plays before it moves on by itself. */
const INTRO_MS = 2300

/**
 * First-run intro: the mark draws itself, the name rises under it, then the language screen.
 * Any key or click skips it. Language-neutral on purpose: the language is chosen right after.
 */
export function Intro({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, INTRO_MS)
    const skip = () => onDone()
    window.addEventListener('keydown', skip)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', skip)
    }
  }, [onDone])

  return (
    <m.div
      key="intro"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.3, ease } }}
      onClick={onDone}
      className="fixed inset-0 z-[90] flex cursor-default flex-col items-center justify-center gap-6 bg-bg"
    >
      <svg viewBox="0 0 64 64" className="size-20" aria-hidden>
        <m.path
          d="M18 16v32h28"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="square"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.7, ease, delay: 0.15 }}
        />
        <m.path
          d="M30 24l14 8-14 8z"
          fill="currentColor"
          initial={{ opacity: 0, transform: 'translate3d(-6px, 0, 0) scale(0.6)' }}
          animate={{ opacity: 1, transform: 'translate3d(0px, 0, 0) scale(1)' }}
          transition={{ duration: 0.45, ease, delay: 0.75 }}
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        />
      </svg>
      <m.div variants={fadeUp} initial="hidden" animate="show" custom={1.0} className="flex flex-col items-center gap-2">
        <span className="text-[26px] font-semibold tracking-[-0.025em] text-fg">Lecture Studio</span>
        <m.span
          initial={{ transform: 'scaleX(0)' }}
          animate={{ transform: 'scaleX(1)' }}
          transition={{ duration: 0.8, ease, delay: 1.25 }}
          className="h-px w-24 origin-left bg-line-strong"
        />
      </m.div>
    </m.div>
  )
}
