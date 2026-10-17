import { AlertTriangle, X } from 'lucide-react'
import { Fragment } from 'react'
import { useJobs, useLibrary, useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { AnimatePresence, m, RouteOutlet, SceneMotion } from '@/components/motion'
import { Onboarding } from '@/features/onboarding/Onboarding'
import { FloatingPlayer } from '@/features/player/FloatingPlayer'
import { BootScreen } from '@/features/system/BootScreen'
import { StoppedScreen } from '@/features/system/StoppedScreen'
import { UpdatingScreen, useUpdateWatcher } from '@/features/system/Update'
import { useUpdates } from '@/features/system/updateStore'
import { cn } from '@/lib/cn'
import { contentIn, ease, fadeUpFlow, sceneOut, sidebarIn } from '@/lib/motion'
import { Sidebar } from './Sidebar'

export function AppShell() {
  const { modals, toasts, dismissToast, stopped, settings, tutorialOpen, setTutorialOpen, focusMode } = useUI()
  const { connected } = useJobs()
  const { loading } = useLibrary()
  const updating = useUpdates((s) => Boolean(s.phase))
  useUpdateWatcher()
  // The boot screen stays until settings and the library are in (or the server is plainly not there).
  const boot = <BootScreen ready={stopped || !connected || (Boolean(settings) && !loading)} />
  if (stopped) return <><StoppedScreen />{boot}</>
  if (updating) return <><UpdatingScreen />{boot}</>

  // Which scene is on stage. First run: only the tutorial (flag in settings.json); a blank screen while settings load.
  // AnimatePresence mode="wait": the tutorial dissolves first, then the app assembles (sidebar, then content).
  const scene = !settings && connected ? 'loading' : settings && !settings.onboarding_done ? 'tutorial' : 'app'

  return (
    <div className="flex h-full">
      {boot}
      <AnimatePresence mode="wait">
        {/* SceneMotion around the tutorial only: it dissolves into the app even with the OS reduce motion, like it moves */}
        {scene === 'tutorial' && (
          <SceneMotion key="tutorial">
            <m.div variants={sceneOut} initial={false} animate="show" exit="exit" className="fixed inset-0 z-[90]">
              <Onboarding />
            </m.div>
          </SceneMotion>
        )}
        {scene === 'app' && (
          <m.div key="app" initial="hidden" animate="show" className="flex h-full w-full">
            <m.div variants={sidebarIn} className="h-full">
              {/* Focus mode takes the sidebar away in one step: the lesson page then flips its player from the old
                  place to the new one, and a sidebar still sliding would move that target mid-flight. */}
              <div className={focusMode ? 'h-full w-0 overflow-hidden' : 'h-full'}>
                <Sidebar />
              </div>
            </m.div>
            <m.main variants={contentIn} className="min-w-0 flex-1 overflow-hidden">
              <RouteOutlet depth={1} className="h-full" />
            </m.main>
            <FloatingPlayer />
          </m.div>
        )}
      </AnimatePresence>

      {/* Replay from Settings: same dissolve on close, no language question. */}
      <AnimatePresence>
        {tutorialOpen && (
          <SceneMotion key="tutorial-replay">
          <m.div
            variants={sceneOut}
            initial={{ opacity: 0 }}
            animate="show"
            exit="exit"
            transition={{ duration: 0.3, ease }}
            className="fixed inset-0 z-[90]"
          >
            <Onboarding replay onClose={() => setTutorialOpen(false)} />
          </m.div>
          </SceneMotion>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {modals.map((entry) => (
          <Fragment key={entry.id}>{entry.render()}</Fragment>
        ))}
      </AnimatePresence>

      <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-80 flex-col gap-2">
        <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <m.div
            key={toast.id}
            layout
            variants={fadeUpFlow}
            initial="hidden"
            animate="show"
            exit="exit"
            className={cn(
              'pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-raised px-3.5 py-2.5 text-[13px] shadow-xl',
              toast.kind === 'error' ? 'border-fg text-fg' : 'border-line-strong text-soft',
            )}
          >
            {toast.kind === 'error' && <Icon as={AlertTriangle} size={15} className="mt-[1px] shrink-0" />}
            <span className="min-w-0 flex-1 break-words">{toast.text}</span>
            <button type="button" onClick={() => dismissToast(toast.id)} className="text-dim hover:text-fg" aria-label="Dismiss">
              <Icon as={X} size={14} />
            </button>
          </m.div>
        ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
