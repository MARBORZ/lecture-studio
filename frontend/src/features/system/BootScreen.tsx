import { useEffect, useState, useSyncExternalStore } from 'react'
import { useUI } from '@/app/AppProvider'
import { AnimatePresence, m } from '@/components/motion'
import { bootAnimationCached } from '@/lib/appearance'
import { ease } from '@/lib/motion'
import { BootMark, LogoMark } from './BootMark'
import { LOOP_SEC } from './markGeometry'

// counted from the page start: at least one full loop of the mark, however fast the load (boot animation on)
const MIN_MS = LOOP_SEC * 1000

// Up until it starts to fade, once per page: what plays under it (the first-run intro) waits, or nobody would see it.
let up = true
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
function leave() {
  if (!up) return
  up = false
  listeners.forEach((fn) => fn())
}

/** True while the boot screen covers the app; false from the moment it starts to fade. */
export function useBootScreenUp(): boolean {
  return useSyncExternalStore(subscribe, () => up)
}

/**
 * Every app start and page reload: the animated mark until the server answered and the library is loaded, then a fade.
 * Takes over the static splash of index.html (#boot), whose first frame is identical. The mark alone, no text.
 * Settings → Interface → Boot animation off: the static mark and no minimum; gone as soon as ready.
 * The switch is read from the cache (lib/appearance.ts) at mount, since the settings are not loaded yet.
 */
export function BootScreen({ ready }: { ready: boolean }) {
  const { settings } = useUI()
  const [animated] = useState(bootAnimationCached)
  const [minDone, setMinDone] = useState(!animated)
  const wait = animated && (settings?.boot_animation ?? true) // switched off elsewhere: the loaded settings win
  const shown = !(ready && (minDone || !wait))

  useEffect(() => {
    document.getElementById('boot')?.remove()
    if (!animated) return
    const done = setTimeout(() => setMinDone(true), Math.max(0, MIN_MS - performance.now()))
    return () => clearTimeout(done)
  }, [animated])

  useEffect(() => {
    if (!shown) leave()
  }, [shown])

  return (
    <AnimatePresence>
      {shown && (
        <m.div
          key="boot"
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35, ease }}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-bg text-fg"
          aria-busy
        >
          {animated ? <BootMark size={160} /> : <LogoMark className="size-40" />}
        </m.div>
      )}
    </AnimatePresence>
  )
}
