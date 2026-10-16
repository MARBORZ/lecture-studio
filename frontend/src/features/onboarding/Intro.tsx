import { useEffect } from 'react'
import { m } from '@/components/motion'
import { BootMark } from '@/features/system/BootMark'
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
      {/* the brand loop itself: the mark comes alive while the name rises */}
      <BootMark size={80} />
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
