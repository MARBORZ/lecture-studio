import { ArrowLeft, ArrowRight, Check, Languages, X } from 'lucide-react'
import { useCallback, useEffect, useState, type ComponentType } from 'react'
import type { UILanguage } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Button, IconButton, Progress } from '@/components/ui'
import type { TKey } from '@/i18n'
import { AnimatePresence, m } from '@/components/motion'
import { cn } from '@/lib/cn'
import { fade, fadeIn, fadeUp, slide } from '@/lib/motion'
import { AssistantArt, DiaryArt, DoneArt, LessonArt, LibraryArt, PowerArt, SettingsArt, StudioArt, WelcomeArt } from './illustrations'
import { AiStep } from './AiStep'
import { useHotkeyLabel } from '@/features/hotkeys/useHotkey'
import { isTyping } from '@/lib/keys'
import { LogoMark } from '@/features/system/BootMark'
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
 */
export function Onboarding({ replay = false, onClose }: { replay?: boolean; onClose?: () => void }) {
  const { settings, patchSettings, toast } = useUI()
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
    <AnimatePresence mode="wait" initial={false}>
      {phase === 'intro' && <Intro key="intro" onDone={toLanguage} />}
      {phase === 'language' && <LanguageScreen key="language" current={settings?.ui_language ?? 'ru'} onChoose={chooseLanguage} />}
      {phase === 'boot' && <Bootstrap key="boot" onDone={toWalk} />}
      {phase === 'walk' && <Walkthrough key="walk" onClose={replay ? onClose : undefined} />}
    </AnimatePresence>
  )
}

function LanguageScreen({ current, onChoose }: { current: UILanguage; onChoose: (l: UILanguage) => void }) {
  const options: Array<{ value: UILanguage; name: string; sample: string }> = [
    { value: 'ru', name: 'Русский', sample: 'Интерфейс и обучение на русском' },
    { value: 'en', name: 'English', sample: 'Interface and tutorial in English' },
  ]
  return (
    <m.div variants={fadeUp} initial="hidden" animate="show" exit="exit" className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-10 bg-bg px-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="flex size-12 items-center justify-center rounded-full border border-line-strong"><Icon as={Languages} size={20} /></span>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Выберите язык · Choose your language</h1>
        <p className="max-w-xl text-[13.5px] leading-relaxed text-muted">Язык интерфейса и обучения. Поменять можно в Настройки → Интерфейс.<br />Interface and tutorial language. Change it later in Settings → Interface.</p>
      </div>
      <div className="grid w-full max-w-xl gap-3 sm:grid-cols-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            autoFocus={o.value === current}
            onClick={() => onChoose(o.value)}
            className="group flex flex-col items-start gap-2 rounded-2xl border border-line-strong bg-surface p-6 text-left transition-colors hover:border-fg focus:border-fg focus:outline-none"
          >
            <span className="text-[20px] font-semibold text-fg">{o.name}</span>
            <span className="text-[13px] text-muted">{o.sample}</span>
            <span className="mt-3 flex items-center gap-1.5 text-[12.5px] text-soft group-hover:text-fg">
              {o.value === 'ru' ? 'Продолжить' : 'Continue'} <Icon as={ArrowRight} size={14} />
            </span>
          </button>
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
    <m.div variants={fade} initial="hidden" animate="show" exit="exit" className="fixed inset-0 z-[90] flex bg-bg">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-line px-5 py-7 md:flex">
        <div className="mb-8 flex items-center gap-2.5 px-2">
          <LogoMark className="size-5" />
          <span className="text-[14px] font-semibold">{t('onboarding.title')}</span>
        </div>
        <ol className="flex flex-col gap-0.5">
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                className={cn('flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-[13px] transition-colors duration-200', i === index ? 'bg-raised text-fg' : i < index ? 'text-soft hover:bg-surface' : 'text-dim hover:bg-surface hover:text-muted')}
              >
                <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full border font-mono text-[10px]', i < index ? 'border-fg bg-fg text-bg' : i === index ? 'border-fg text-fg' : 'border-line-strong')}>
                  {i < index ? <Icon as={Check} size={11} strokeWidth={2.4} /> : i + 1}
                </span>
                <span className="truncate">{t(k(s.id, 'title'))}</span>
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {/* One column width for header, step and footer: edges line up on every step. */}
        <div className={cn(COLUMN, 'flex items-center gap-4 pt-7')}>
          <Progress value={((index + 1) / STEPS.length) * 100} className="flex-1" />
          <span className="font-mono text-[12px] text-muted tabular-nums">{t('onboarding.step', { n: index + 1, total: STEPS.length })}</span>
          {onClose && <IconButton icon={X} size="sm" label={t('common.close')} onClick={onClose} className="-mr-2" />}
        </div>

        <div className="scroll-area flex flex-1 flex-col overflow-x-clip">
          <div className={cn(COLUMN, 'flex flex-1 items-center py-10')}>
            <AnimatePresence mode="wait" custom={direction} initial={false}>
              <m.div
                key={step.id}
                custom={direction}
                variants={slide}
                initial="hidden"
                animate="show"
                exit="exit"
                className="grid w-full items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
              >
                <m.section variants={fadeIn} initial="hidden" animate="show" custom={0.04} className="max-w-md">
                  <h1 className="text-[32px] leading-[1.15] font-semibold tracking-[-0.025em] text-fg">{t(k(step.id, 'title'))}</h1>
                  <p className="mt-4 text-[15px] leading-relaxed text-soft">{t(k(step.id, 'lead'))}</p>
                  <ul className="mt-7 flex flex-col gap-3.5">
                    {(['b1', 'b2', 'b3'] as const).map((b, i) => (
                      <m.li key={b} variants={fadeIn} initial="hidden" animate="show" custom={0.14 + i * 0.07} className="flex gap-3 text-[14px] leading-snug text-soft">
                        <span className="mt-[2px] flex size-[18px] shrink-0 items-center justify-center rounded-full border border-line-strong"><Icon as={Check} size={10} /></span>
                        {t(k(step.id, b), keys)}
                      </m.li>
                    ))}
                  </ul>
                </m.section>
                <m.div variants={fadeIn} initial="hidden" animate="show" custom={0.1} className="w-full lg:justify-self-end">
                  <Art onNext={next} />
                </m.div>
              </m.div>
            </AnimatePresence>
          </div>
        </div>

        <footer className="border-t border-line">
          <div className={cn(COLUMN, 'flex items-center justify-between gap-4 py-4')}>
            <Button variant="ghost" icon={ArrowLeft} disabled={index === 0} onClick={back}>{t('onboarding.back')}</Button>
            <span className="hidden text-[12px] text-dim sm:block">{t('onboarding.keysHint')}</span>
            <Button variant="primary" iconRight={last ? Check : ArrowRight} loading={finishing} onClick={next} className="min-w-36">
              {last ? (onClose ? t('common.close') : t('onboarding.finish')) : t('onboarding.next')}
            </Button>
          </div>
        </footer>
      </main>
    </m.div>
  )
}
