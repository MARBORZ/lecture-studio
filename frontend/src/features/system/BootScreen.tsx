import { useEffect, useState } from 'react'
import { useUI } from '@/app/AppProvider'
import { AnimatePresence, m } from '@/components/motion'
import { ease } from '@/lib/motion'
import type { TKey } from '@/i18n'

/** The mark in the middle; index.html shows the same file before any script runs, so the hand-over has no seam. */
export const BOOT_MEDIA = '/logo.svg'
const MIN_MS = 1200 // counted from the page start: a fast load still shows the mark, not a flash
const PUNCH_AFTER_MS = 2500 // lines appear only when loading takes a while
const PUNCH_EVERY_MS = 3200
const PUNCHLINES: TKey[] = ['boot.punch1', 'boot.punch2', 'boot.punch3', 'boot.punch4', 'boot.punch5', 'boot.punch6', 'boot.punch7', 'boot.punch8']

/**
 * Every app start and page reload: the mark until the server answered and the library is loaded, then a fade.
 * Takes over the static splash of index.html (#boot).
 */
export function BootScreen({ ready }: { ready: boolean }) {
  const { t } = useUI()
  const [minDone, setMinDone] = useState(false)
  const [line, setLine] = useState(-1)

  useEffect(() => {
    document.getElementById('boot')?.remove()
    const done = setTimeout(() => setMinDone(true), Math.max(0, MIN_MS - performance.now()))
    let tick: ReturnType<typeof setInterval> | undefined
    const start = setTimeout(() => {
      setLine(Math.floor(Math.random() * PUNCHLINES.length))
      tick = setInterval(() => setLine((i) => (i + 1) % PUNCHLINES.length), PUNCH_EVERY_MS)
    }, Math.max(0, PUNCH_AFTER_MS - performance.now()))
    return () => {
      clearTimeout(done)
      clearTimeout(start)
      clearInterval(tick)
    }
  }, [])

  return (
    <AnimatePresence>
      {!(ready && minDone) && (
        <m.div
          key="boot"
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35, ease }}
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-bg"
          aria-busy
        >
          <img src={BOOT_MEDIA} alt="Lecture Studio" className="size-24" draggable={false} />
          <div className="absolute inset-x-6 bottom-[18%] flex h-6 justify-center">
            <AnimatePresence mode="wait">
              {line >= 0 && (
                <m.p
                  key={line}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4, ease }}
                  className="text-center text-[13px] text-muted"
                >
                  {t(PUNCHLINES[line])}
                </m.p>
              )}
            </AnimatePresence>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  )
}
