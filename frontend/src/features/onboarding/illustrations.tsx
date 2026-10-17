/**
 * Monochrome sketches for the tutorial: one idea each, no cards around them. Built from the app's own primitives and
 * i18n keys, so they match the real screens and switch language with them. Their parts join the step's cascade
 * (lib/motion stepItem): no timings of their own.
 */
import { Check, Play, Power } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Progress, StatusMark } from '@/components/ui'
import { SECTIONS } from '@/pages/settings/SettingsLayout'
import { AnimatePresence, m } from '@/components/motion'
import { LogoMark } from '@/features/system/BootMark'
import { cn } from '@/lib/cn'
import { badgePop, drawCheck, fade, ripple, stepItem } from '@/lib/motion'

/** Same box on every step (fixed min height, content centred), so steps do not jump. */
export function Frame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="flex min-h-[340px] w-full max-w-[440px] flex-col justify-center">
      <div className={cn('w-full', className)}>{children}</div>
    </div>
  )
}

/** One part of a sketch, in the step's cascade. */
function In({ className, children }: { className?: string; children: ReactNode }) {
  return <m.div variants={stepItem} className={className}>{children}</m.div>
}

/** A looping index, 0..count-1, every ms: the little demos (stages, playhead, settings) run on it. */
function useTicker(count: number, ms: number) {
  const [i, setI] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setI((v) => (v + 1) % count), ms)
    return () => window.clearInterval(id)
  }, [count, ms])
  return i
}

/** A line that changes in place (stage, chapter): the old one fades out, the new one in. */
function Swap({ id, className, children }: { id: string | number; className?: string; children: ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <m.span key={id} variants={fade} initial="hidden" animate="show" exit="exit" className={cn('flex items-center gap-2', className)}>
        {children}
      </m.span>
    </AnimatePresence>
  )
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-flex rounded-[5px] border border-line-strong px-1.5 font-mono text-[11.5px] leading-[18px] text-fg">{children}</span>
}

export function WelcomeArt() {
  return (
    <Frame className="flex justify-center">
      <In>
        <LogoMark className="size-28" />
      </In>
    </Frame>
  )
}

export function LibraryArt() {
  const { t } = useUI()
  const lessons = [
    { title: t('onboarding.sample.lesson1'), status: 'completed' as const },
    { title: t('onboarding.sample.lesson2'), status: 'to_review' as const },
    { title: t('onboarding.sample.lesson3'), status: 'in_progress' as const },
  ]
  return (
    <Frame className="flex flex-col">
      {lessons.map((l) => (
        <In key={l.title} className="flex items-center gap-4 border-b border-line py-4 text-[15px] last:border-0">
          <StatusMark status={l.status} />
          <span className="truncate text-fg">{l.title}</span>
        </In>
      ))}
    </Frame>
  )
}

export function StudioArt() {
  const { t } = useUI()
  const stages = ['extract', 'vad', 'audio', 'video', 'transcribe', 'audit'] as const
  const current = useTicker(stages.length + 1, 750) // the extra tick = all done, then it starts over
  const progress = Math.round((current / stages.length) * 100)
  return (
    <Frame className="flex flex-col gap-4">
      <In className="flex items-baseline justify-between">
        <span className="text-[15px] text-fg">Lecture_03.mov</span>
        <span className="font-mono text-[13px] text-muted tabular-nums">{progress}%</span>
      </In>
      <In>
        <Progress value={progress} />
      </In>
      <In className="h-5 text-[13px] text-soft">
        <Swap id={current}>{current < stages.length ? t(`stage.${stages[current]}`) : <Icon as={Check} size={14} className="text-fg" />}</Swap>
      </In>
    </Frame>
  )
}

export function LessonArt() {
  const { t } = useUI()
  const marks = [18, 38, 61, 83]
  const at = useTicker(marks.length, 1300)
  const chapter = at % 2 === 0 ? { time: '04:15', title: t('onboarding.sample.chapter1') } : { time: '04:42', title: t('onboarding.sample.chapter2') }
  return (
    <Frame className="flex flex-col gap-4">
      <In className="flex aspect-video items-center justify-center rounded-2xl bg-raised">
        <span className="flex size-12 items-center justify-center rounded-full bg-fg text-bg"><Icon as={Play} size={18} fill="currentColor" strokeWidth={0} className="translate-x-[1px]" /></span>
      </In>
      <In className="relative h-1 rounded-full bg-line">
        {/* scaleX, not width: the playhead moves on the compositor */}
        <div
          className="absolute inset-0 origin-left rounded-full bg-fg transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ transform: `scaleX(${marks[at] / 100})` }}
        />
        {marks.map((x) => <span key={x} className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-muted" style={{ left: `${x}%` }} />)}
      </In>
      <In className="h-5 text-[13.5px] text-fg">
        <Swap id={chapter.time}><Chip>{chapter.time}</Chip>{chapter.title}</Swap>
      </In>
    </Frame>
  )
}

export function AssistantArt() {
  const { t } = useUI()
  return (
    <Frame className="flex flex-col gap-4 text-[14px]">
      <In className="ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-raised px-4 py-2.5 text-fg">{t('onboarding.assistant.sampleQ')}</In>
      <In className="max-w-[90%] leading-relaxed text-soft">
        {t('onboarding.assistant.sampleA')} <Chip>{t('onboarding.sample.citation')} · 00:38</Chip>
      </In>
    </Frame>
  )
}

export function DiaryArt() {
  const { t } = useUI()
  return (
    <Frame className="flex flex-col">
      {[t('onboarding.diary.sample1'), t('onboarding.diary.sample2')].map((s, i) => (
        <In key={i} className="border-b border-line py-4 last:border-0">
          <p className="text-[15px] text-fg">{s}</p>
          <p className="mt-1.5 font-mono text-[11px] text-dim">{t(i ? 'onboarding.sample.category2' : 'onboarding.sample.category1')} · 14:0{i + 2}</p>
        </In>
      ))}
    </Frame>
  )
}

export function SettingsArt() {
  const { t } = useUI()
  const active = useTicker(SECTIONS.length, 1100)
  return (
    <Frame className="flex flex-col gap-0.5">
      {SECTIONS.map((s, i) => (
        <In key={s.to} className={cn('flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] transition-colors duration-300', i === active ? 'bg-raised text-fg' : 'text-muted')}>
          <Icon as={s.icon} size={15} />
          {t(s.key)}
        </In>
      ))}
    </Frame>
  )
}

export function PowerArt() {
  const { t } = useUI()
  return (
    <Frame className="flex flex-col items-center gap-5">
      <In className="flex size-20 items-center justify-center rounded-full border border-line-strong text-fg">
        <Icon as={Power} size={26} />
      </In>
      <In className="text-[15px] text-fg">{t('nav.shutdown')}</In>
    </Frame>
  )
}

export function DoneArt() {
  return (
    <Frame className="flex justify-center">
      <In className="relative flex size-44 items-center justify-center">
        {/* soft rings breathing out of the badge */}
        {[0, 1, 2].map((i) => (
          <m.span key={i} aria-hidden variants={ripple} custom={i} className="absolute inset-4 rounded-full border border-fg" />
        ))}
        <m.div variants={badgePop} className="relative flex size-24 items-center justify-center rounded-full bg-fg shadow-glow">
          <svg viewBox="0 0 48 48" className="size-12 text-bg" aria-hidden>
            <m.path variants={drawCheck} d="M13 25l7.5 7.5L35.5 16" fill="none" stroke="currentColor" strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </m.div>
      </In>
    </Frame>
  )
}
