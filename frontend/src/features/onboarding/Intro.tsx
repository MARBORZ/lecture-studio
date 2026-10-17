import { useEffect } from 'react'
import { m } from '@/components/motion'
import { BootMark } from '@/features/system/BootMark'
import { drawLine, fade, fadeUp } from '@/lib/motion'

/** How long the intro plays before it moves on by itself. */
const INTRO_MS = 2300

/**
 * First-run intro: the mark draws itself, the name rises under it, then the language screen.
 * Any key or click skips it. Language-neutral on purpose: the language is chosen right after.
 * Starts as the boot screen fades, with the mark at the boot mark's size and place (the name hangs below it), so the
 * boot loop runs on into the intro without a seam.
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
      variants={fade}
      initial={false}
      animate="show"
      exit="exit"
      onClick={onDone}
      className="fixed inset-0 z-[90] flex cursor-default items-center justify-center bg-bg"
    >
      {/* the brand loop itself: the mark comes alive while the name rises */}
      <div className="relative flex">
        <BootMark size={160} />
        <div className="absolute inset-x-0 top-full mt-6 flex justify-center">
          <m.div variants={fadeUp} initial="hidden" animate="show" custom={1.0} className="flex flex-col items-center gap-2 whitespace-nowrap">
            <span className="text-[26px] font-semibold tracking-[-0.025em] text-fg">Lecture Studio</span>
            <m.span variants={drawLine} initial="hidden" animate="show" custom={1.25} className="h-px w-24 origin-left bg-line-strong" />
          </m.div>
        </div>
      </div>
    </m.div>
  )
}
