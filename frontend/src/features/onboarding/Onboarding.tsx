import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react'
import { useCallback, useEffect, useState, type ComponentType } from 'react'
import type { UILanguage } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Button, IconButton } from '@/components/ui'
import type { TKey } from '@/i18n'
import { AnimatePresence, m, SceneMotion } from '@/components/motion'
import { cn } from '@/lib/cn'
import { fade, stepIn, stepItem } from '@/lib/motion'
import { AssistantArt, DiaryArt, DoneArt, LessonArt, LibraryArt, PowerArt, SettingsArt, StudioArt, WelcomeArt } from './illustrations'
import { AiStep } from './AiStep'
import { useHotkeyLabel } from '@/features/hotkeys/useHotkey'
import { isTyping } from '@/lib/keys'
import { LogoMark } from '@/features/system/BootMark'
import { useBootScreenUp } from '@/features/system/BootScreen'
import { Bootstrap } from './Bootstrap'
import { Intro } from './Intro'

type StepId = 'welcome' | 'library' | 'studio' | 'lesson' | 'assistant' | 'diary' | 'ai' | 'settings' | 'power' | 'done'

// art gets onNext: the AI step's "Skip" moves on
const STEPS: Array<{ id: StepId; art: ComponentType<{ onNext: () => void }> }> = [
  { id: 'welcome', art: WelcomeArt },
  { id: 'library', art: LibraryArt },
  { id: 'studio', art: StudioArt },
  { id: 'lesson', art: LessonArt },
  { id: 'assistant', art: AssistantArt },
  { id: 'diary', art: DiaryArt },
  { id: 'ai', art: AiStep },
  { id: 'settings', art: SettingsArt },
  { id: 'power', art: PowerArt },
  { id: 'done', art: DoneArt },
]

const COLUMN = 'mx-auto w-full max-w-[1080px] px-10'

const k = (id: StepId, part: 'title' | 'lead' | 'b1' | 'b2' | 'b3') => `onboarding.${id}.${part}` as TKey

/**
 * Tutorial.
 *   first run  — mandatory: intro, language (both languages on screen), a check of this computer, the walkthrough;
 *                completion -> settings.json
 *   replay     — from Settings -> Interface: straight to the walkthrough in the current language, closable, flag untouched
 * A scene, like the boot mark and focus mode: it moves even with the OS "reduce motion" (the user's decision).
 */
export function Onboarding({ replay = false, onClose }: { replay?: boolean; onClose?: () => void }) {
  const { settings, patchSettings, toast } = useUI()
  const bootUp = useBootScreenUp() // first run: the intro starts as the boot screen fades, not unseen under it
  const [phase, setPhase] = useState<'intro' | 'language' | 'boot' | 'walk'>(replay ? 'walk' : 'intro')
  const toLanguage = useCallback(() => setPhase((p) => (p === 'intro' ? 'language' : p)), [])
  const toWalk = useCallback(() => setPhase('walk'), [])

  async function chooseLanguage(lang: UILanguage) {
    try {
      await patchSettings({ ui_language: lang })
      setPhase('boot')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  return (
    <SceneMotion>
      <AnimatePresence mode="wait" initial={false}>
        {phase === 'intro' && !bootUp && <Intro key="intro" onDone={toLanguage} />}
        {phase === 'language' && <LanguageScreen key="language" current={settings?.ui_language ?? 'ru'} onChoose={chooseLanguage} />}
        {phase === 'boot' && <Bootstrap key="boot" onDone={toWalk} />}
        {phase === 'walk' && <Walkthrough key="walk" onClose={replay ? onClose : undefined} />}
      </AnimatePresence>
    </SceneMotion>
  )
}

/** Both languages on one screen (the interface has none yet): two large words, nothing else to read first. */
function LanguageScreen({ current, onChoose }: { current: UILanguage; onChoose: (l: UILanguage) => void }) {
  const options: Array<{ value: UILanguage; name: string; sample: string; go: string }> = [
    { value: 'ru', name: 'Русский', sample: 'Интерфейс и обучение на русском', go: 'Продолжить' },
    { value: 'en', name: 'English', sample: 'Interface and tutorial in English', go: 'Continue' },
  ]
  return (
    <m.div variants={stepIn} initial="hidden" animate="show" exit="exit" className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-14 bg-bg px-6">
      <m.div variants={stepItem} className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-[15px] font-medium text-soft">Выберите язык · Choose your language</h1>
        <p className="text-[12.5px] leading-relaxed text-dim">Поменять можно в Настройки → Интерфейс · Change it later in Settings → Interface</p>
      </m.div>
      <div className="grid w-full max-w-2xl gap-3 sm:grid-cols-2">
        {options.map((o) => (
          <m.button
            key={o.value}
            variants={stepItem}
            type="button"
            autoFocus={o.value === current}
            onClick={() => onChoose(o.value)}
            className="group flex flex-col items-start gap-2 rounded-3xl p-8 text-left transition-colors duration-200 hover:bg-surface focus-visible:bg-surface focus-visible:outline-none"
          >
            <span className="text-[40px] leading-none font-semibold tracking-[-0.035em] text-fg">{o.name}</span>
            <span className="text-[13.5px] text-muted">{o.sample}</span>
            <span className="mt-6 flex items-center gap-1.5 text-[13px] text-dim transition-colors duration-200 group-hover:text-fg group-focus-visible:text-fg">
              {o.go} <Icon as={ArrowRight} size={14} />
            </span>
          </m.button>
        ))}
      </div>
    </m.div>
  )
}

/** onClose set = replay mode: closable, finishing just closes. */
function Walkthrough({ onClose }: { onClose?: () => void }) {
  const { t, patchSettings, toast } = useUI()
  const [[index, direction], setStep] = useState<[number, number]>([0, 1])
  // the player's current combinations for the lesson step (Settings → Hotkeys); "—" for one turned off
  const keys = { play: useHotkeyLabel('player.toggle') || '—', back: useHotkeyLabel('player.back') || '—', forward: useHotkeyLabel('player.forward') || '—' }
  const setIndex = useCallback((next: number | ((i: number) => number)) => {
    setStep(([i]) => {
      const n = typeof next === 'function' ? next(i) : next
      return [n, n >= i ? 1 : -1]
    })
  }, [])
  const [finishing, setFinishing] = useState(false)
  const step = STEPS[index]
  const last = index === STEPS.length - 1
  const Art = step.art

  const finish = useCallback(async () => {
    if (onClose) return onClose()
    setFinishing(true)
    try {
      await patchSettings({ onboarding_done: true }) // gate opens; the user stays where they are
    } catch (e) {
      toast((e as Error).message, 'error')
      setFinishing(false)
    }
  }, [onClose, patchSettings, toast])

  const next = useCallback(() => (last ? void finish() : setIndex((i) => i + 1)), [last, finish, setIndex])
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [setIndex])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return
      // Enter on a focused button presses that button (Next included), never a second step forward
      if (e.key === 'Enter' && e.target instanceof Element && e.target.closest('button, a')) return
      if (e.key === 'Escape' && onClose) onClose()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      else if (e.key === 'ArrowLeft') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, back, onClose])

  return (
    <m.div variants={fade} initial="hidden" animate="show" exit="exit" className="fixed inset-0 z-[90] flex flex-col bg-bg">
      <header className={cn(COLUMN, 'flex h-20 shrink-0 items-center justify-between')}>
        <LogoMark className="size-5" />
        {onClose && <IconButton icon={X} size="sm" label={t('common.close')} onClick={onClose} className="-mr-2" />}
      </header>

      <div className="scroll-area flex flex-1 flex-col overflow-x-clip">
        <div className={cn(COLUMN, 'flex flex-1 items-center py-10')}>
          <AnimatePresence mode="wait" custom={direction}>
            <m.div
              key={step.id}
              custom={direction}
              variants={stepIn}
              initial="hidden"
              animate="show"
              exit="exit"
              data-step={step.id}
              className="grid w-full items-center gap-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
            >
              <div className="max-w-md">
                <m.h1 variants={stepItem} className="text-[44px] leading-[1.05] font-semibold tracking-[-0.035em] text-fg">{t(k(step.id, 'title'))}</m.h1>
                <m.p variants={stepItem} className="mt-5 text-[17px] leading-relaxed text-soft">{t(k(step.id, 'lead'))}</m.p>
                <ul className="mt-10 flex flex-col gap-3">
                  {(['b1', 'b2', 'b3'] as const).map((b) => (
                    <m.li key={b} variants={stepItem} className="flex gap-3 text-[13.5px] leading-snug text-muted">
                      <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-dim" />
                      {t(k(step.id, b), keys)}
                    </m.li>
                  ))}
                </ul>
              </div>
              <m.div variants={stepItem} className="w-full lg:justify-self-end">
                <Art onNext={next} />
              </m.div>
            </m.div>
          </AnimatePresence>
        </div>
      </div>

      <footer className={cn(COLUMN, 'flex h-24 shrink-0 items-center justify-between gap-4')}>
        <Button variant="ghost" icon={ArrowLeft} disabled={index === 0} onClick={back} className={cn(index === 0 && 'invisible')}>{t('onboarding.back')}</Button>
        {/* where you are: one dot per step, the current one bright; each jumps to its step */}
        <ol className="flex items-center" aria-label={t('onboarding.title')}>
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={t(k(s.id, 'title'))}
                aria-current={i === index ? 'step' : undefined}
                title={t(k(s.id, 'title'))}
                className="group flex size-6 items-center justify-center focus-visible:outline-none"
              >
                <span
                  className={cn(
                    'size-1.5 rounded-full transition-[background-color,scale] duration-300',
                    i === index ? 'scale-125 bg-fg' : i < index ? 'bg-muted group-hover:bg-soft' : 'bg-line-strong group-hover:bg-muted group-focus-visible:bg-muted',
                  )}
                />
              </button>
            </li>
          ))}
        </ol>
        <Button variant="primary" iconRight={last ? Check : ArrowRight} loading={finishing} onClick={next} className="min-w-36">
          {last ? (onClose ? t('common.close') : t('onboarding.finish')) : t('onboarding.next')}
        </Button>
      </footer>
    </m.div>
  )
}
