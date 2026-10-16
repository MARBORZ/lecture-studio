import { useEffect, useState } from 'react'
import { useUI } from '@/app/AppProvider'
import { AnimatePresence, m } from '@/components/motion'
import { bootAnimationCached } from '@/lib/appearance'
import { ease } from '@/lib/motion'
import type { TKey } from '@/i18n'
import { BootMark, LogoMark } from './BootMark'
import { LOOP_SEC } from './markGeometry'

// counted from the page start: at least one full loop of the mark, however fast the load (boot animation on)
const MIN_MS = LOOP_SEC * 1000
const PUNCH_AFTER_MS = LOOP_SEC * 1000 // still loading after the first loop: the lines start, the loop goes on
const PUNCH_EVERY_MS = 2500
const PUNCHLINES: TKey[] = ['boot.punch1', 'boot.punch2', 'boot.punch3', 'boot.punch4', 'boot.punch5', 'boot.punch6', 'boot.punch7', 'boot.punch8']

/**
 * Every app start and page reload: the animated mark until the server answered and the library is loaded, then a fade.
 * Takes over the static splash of index.html (#boot), whose first frame is identical.
 * Settings → Interface → Boot animation off: the static mark, no minimum and no lines; gone as soon as ready.
 * The switch is read from the cache (lib/appearance.ts) at mount, since the settings are not loaded yet.
 */
export function BootScreen({ ready }: { ready: boolean }) {
  const { t, settings } = useUI()
  const [animated] = useState(bootAnimationCached)
  const [minDone, setMinDone] = useState(!animated)
  const [line, setLine] = useState(-1)
  const wait = animated && (settings?.boot_animation ?? true) // switched off elsewhere: the loaded settings win

  useEffect(() => {
    document.getElementById('boot')?.remove()
    if (!animated) return
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
  }, [animated])

  return (
    <AnimatePresence>
      {!(ready && (minDone || !wait)) && (
        <m.div
          key="boot"
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35, ease }}
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-bg text-fg"
          aria-busy
        >
          {animated ? <BootMark size={160} /> : <LogoMark className="size-40" />}
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
