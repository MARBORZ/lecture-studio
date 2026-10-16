/**
 * Monochrome mini-mockups for the tutorial. Built from the app's own primitives and i18n keys,
 * so they look like the real screens and switch language with them.
 */
import { Check, Clapperboard, Library, MessagesSquare, NotebookPen, Play, Power, ScrollText, Scissors, Settings, Upload } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Progress, StatusMark } from '@/components/ui'
import { SECTIONS } from '@/pages/settings/SettingsLayout'
import { m } from '@/components/motion'
import { LogoMark } from '@/features/system/BootMark'
import { cn } from '@/lib/cn'
import { ease, fadeUp, pop, springBouncy } from '@/lib/motion'

/** Same box on every step (fixed min height, content centred), so steps do not jump. */
export function Frame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="flex min-h-[340px] w-full max-w-[480px] flex-col justify-center rounded-2xl border border-line-strong bg-surface p-6 shadow-2xl">
      <div className={cn('w-full', className)}>{children}</div>
    </div>
  )
}

/** Staggered entrance inside an illustration; d = delay in seconds. Transform + opacity only. */
function In({ d = 0, className, children }: { d?: number; className?: string; children: ReactNode }) {
  return (
    <m.div variants={fadeUp} initial="hidden" animate="show" custom={d} className={className}>
      {children}
    </m.div>
  )
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

function Chip({ children }: { children: ReactNode }) {
  return <span className="mx-0.5 inline-flex rounded-[5px] border border-line-strong bg-raised px-1.5 font-mono text-[11.5px] leading-[18px] text-fg">{children}</span>
}

export function WelcomeArt() {
  const rows = [
    { icon: Scissors, w: 'w-3/4' },
    { icon: ScrollText, w: 'w-2/3' },
    { icon: MessagesSquare, w: 'w-4/5' },
  ]
  return (
    <Frame className="flex flex-col items-center gap-6 py-10">
      <m.div variants={pop} initial="hidden" animate="show">
        <LogoMark className="size-16" />
      </m.div>
      <div className="flex w-full max-w-xs flex-col gap-3">
        {rows.map((r, i) => (
          <In key={i} d={0.35 + i * 0.1} className="flex items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded-lg border border-line"><Icon as={r.icon} size={15} /></span>
            <m.span
              initial={{ transform: 'scaleX(0)' }}
              animate={{ transform: 'scaleX(1)' }}
              transition={{ duration: 0.6, ease, delay: 0.5 + i * 0.1 }}
              className={cn('h-2 origin-left rounded-full bg-line-strong', r.w)}
            />
          </In>
        ))}
      </div>
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
    <Frame className="grid grid-cols-[120px_1fr] gap-4">
      <div className="flex flex-col gap-1 border-r border-line pr-3 text-[12px]">
        <span className="flex items-center gap-2 rounded-md bg-raised px-2 py-1.5 text-fg"><Icon as={Library} size={13} />{t('nav.library')}</span>
        <span className="label-caps mt-3 mb-1 px-2">{t('nav.notebooks')}</span>
        <span className="rounded-md px-2 py-1 text-soft">Python</span>
        <span className="rounded-md px-2 py-1 text-muted">Docker</span>
      </div>
      <div className="flex flex-col divide-y divide-line rounded-xl border border-line">
        {lessons.map((l, i) => (
          <In key={l.title} d={0.12 + i * 0.09} className="flex items-center gap-3 px-3 py-2.5 text-[12.5px]">
            <StatusMark status={l.status} />
            <span className="flex-1 truncate text-fg">{l.title}</span>
            <span className="text-[11px] text-muted">{t(`status.${l.status}`)}</span>
          </In>
        ))}
      </div>
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
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong py-6 text-[12.5px] text-soft">
        <Icon as={Upload} size={18} />
        {t('studio.drop')}
      </div>
      <div className="rounded-xl border border-line p-3">
        <div className="mb-2 flex justify-between text-[12px]"><span className="text-fg">Lecture_03.mov</span><span className="font-mono tabular-nums">{progress}%</span></div>
        <Progress value={progress} />
        <div className="mt-3 flex flex-wrap gap-1.5">
          {stages.map((s, i) => (
            <span key={s} className={cn('flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] transition-colors duration-300', i < current ? 'border-line-strong text-soft' : i === current ? 'border-fg text-fg' : 'border-line text-dim')}>
              {i < current && <Icon as={Check} size={11} />}
              {t(`stage.${s}`)}
            </span>
          ))}
        </div>
      </div>
    </Frame>
  )
}

export function LessonArt() {
  const { t } = useUI()
  const marks = [18, 38, 61, 83]
  const at = useTicker(marks.length, 1300)
  return (
    <Frame className="flex flex-col gap-3">
      <div className="flex aspect-video items-center justify-center rounded-xl border border-line bg-black">
        <span className="flex size-11 items-center justify-center rounded-full bg-fg text-bg"><Icon as={Play} size={18} fill="currentColor" strokeWidth={0} className="translate-x-[1px]" /></span>
      </div>
      <div className="relative h-1 rounded-full bg-line">
        {/* scaleX, not width: the playhead moves on the compositor */}
        <div
          className="absolute inset-0 origin-left rounded-full bg-fg transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ transform: `scaleX(${marks[at] / 100})` }}
        />
        {marks.map((x) => <span key={x} className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-muted" style={{ left: `${x}%` }} />)}
      </div>
      <div className="flex flex-col gap-1.5 text-[12.5px] text-soft">
        <p className={cn('font-semibold transition-colors duration-300', at % 2 === 0 ? 'text-fg' : 'text-muted')}><Chip>04:15</Chip> {t('onboarding.sample.chapter1')}</p>
        <p className={cn('pl-3 transition-colors duration-300', at % 2 === 1 ? 'text-fg' : 'text-muted')}>— <Chip>04:42</Chip> {t('onboarding.sample.chapter2')}</p>
      </div>
    </Frame>
  )
}

export function AssistantArt() {
  const { t } = useUI()
  return (
    <Frame className="flex flex-col gap-3 text-[12.5px]">
      <In d={0.08} className="ml-auto max-w-[80%] rounded-xl rounded-br-sm bg-raised px-3 py-2 text-fg">{t('onboarding.assistant.sampleQ')}</In>
      <In d={0.45} className="rounded-xl border border-line p-3 text-soft">
        {t('onboarding.assistant.sampleA')}{' '}
        <m.span variants={pop} initial="hidden" animate="show" transition={{ delay: 0.85 }} className="inline-block">
          <Chip>{t('onboarding.sample.citation')} · 00:38</Chip>
        </m.span>
        <m.div initial={{ transform: 'scaleX(0)' }} animate={{ transform: 'scaleX(1)' }} transition={{ duration: 0.6, ease, delay: 0.7 }} className="mt-2 h-1.5 w-3/4 origin-left rounded-full bg-line" />
        <m.div initial={{ transform: 'scaleX(0)' }} animate={{ transform: 'scaleX(1)' }} transition={{ duration: 0.6, ease, delay: 0.8 }} className="mt-1.5 h-1.5 w-1/2 origin-left rounded-full bg-line" />
      </In>
      <div className="flex flex-wrap gap-1.5">
        {(['key_moments', 'pitfalls', 'code_summary', 'quiz', 'chapters'] as const).map((r, i) => (
          <In key={r} d={1 + i * 0.05}>
            <span className="block rounded-md border border-line-strong px-2 py-0.5 text-[11px] text-soft">{t(`assistant.role.${r}`)}</span>
          </In>
        ))}
      </div>
    </Frame>
  )
}

export function DiaryArt() {
  const { t } = useUI()
  return (
    <Frame className="flex flex-col gap-3 text-[12.5px]">
      <div className="rounded-xl border border-line-strong px-3 py-2.5 text-dim">{t('diary.composer')}</div>
      {[t('onboarding.diary.sample1'), t('onboarding.diary.sample2')].map((s, i) => (
        <In key={i} d={0.15 + i * 0.12} className="rounded-xl border border-line px-3 py-2.5">
          <p className="text-fg">{s}</p>
          <p className="mt-1 font-mono text-[10.5px] text-dim">{t(i ? 'onboarding.sample.category2' : 'onboarding.sample.category1')} · 14:0{i + 2}</p>
        </In>
      ))}
      <In d={0.45} className="flex items-center gap-2 text-dim"><Icon as={NotebookPen} size={13} /> diary/{t('onboarding.sample.category1')}/2026-10-15 1402.md</In>
    </Frame>
  )
}

export function SettingsArt() {
  const { t } = useUI()
  const active = useTicker(SECTIONS.length, 1100)
  return (
    <Frame className="flex flex-col gap-1">
      {SECTIONS.map((s, i) => (
        <span key={s.to} className={cn('flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors duration-300', i === active ? 'bg-raised text-fg' : 'text-soft')}>
          <Icon as={s.icon} size={15} />
          {t(s.key)}
        </span>
      ))}
    </Frame>
  )
}

export function PowerArt() {
  const { t } = useUI()
  return (
    <Frame className="flex flex-col gap-4">
      <m.div variants={pop} initial="hidden" animate="show" transition={{ delay: 0.15 }} className="rounded-xl border border-line-strong p-4">
        <p className="text-[13px] font-semibold text-fg">{t('system.shutdownTitle')}</p>
        <p className="mt-1 text-[12px] leading-snug text-muted">{t('system.shutdownText')}</p>
        <div className="mt-3 flex justify-end gap-2 text-[12px]">
          <span className="rounded-md px-2.5 py-1 text-soft">{t('common.cancel')}</span>
          <span className="flex items-center gap-1.5 rounded-md border border-fg px-2.5 py-1 text-fg"><Icon as={Power} size={12} />{t('nav.shutdown')}</span>
        </div>
      </m.div>
      <div className="flex items-center gap-2 text-[12px] text-muted"><Icon as={Clapperboard} size={13} />Lecture Studio — Desktop</div>
    </Frame>
  )
}

export function DoneArt() {
  const { t } = useUI()
  const tiles = [
    { icon: Clapperboard, key: 'nav.studio' },
    { icon: Library, key: 'nav.library' },
    { icon: NotebookPen, key: 'nav.diary' },
    { icon: Settings, key: 'nav.settings' },
  ] as const
  return (
    <Frame className="flex flex-col items-center gap-9">
      <div className="relative flex size-40 items-center justify-center">
        {/* soft rings breathing out of the badge */}
        {[0, 1, 2].map((i) => (
          <m.span
            key={i}
            aria-hidden
            className="absolute inset-3 rounded-full border border-fg"
            initial={{ opacity: 0, transform: 'scale(0.7)' }}
            animate={{ opacity: [0, 0.32, 0], transform: ['scale(0.7)', 'scale(1.05)', 'scale(1.5)'] }}
            transition={{ duration: 2.6, ease, delay: 0.7 + i * 0.85, repeat: Infinity }}
          />
        ))}
        <m.div
          initial={{ opacity: 0, transform: 'scale(0.4)' }}
          animate={{ opacity: 1, transform: 'scale(1)' }}
          transition={springBouncy}
          className="relative flex size-24 items-center justify-center rounded-full bg-fg shadow-glow"
        >
          <svg viewBox="0 0 48 48" className="size-12 text-bg" aria-hidden>
            <m.path
              d="M13 25l7.5 7.5L35.5 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={4.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.55, ease, delay: 0.32 }}
            />
          </svg>
        </m.div>
      </div>
      <div className="grid w-full grid-cols-4 gap-2">
        {tiles.map((tile, i) => (
          <m.div
            key={tile.key}
            variants={fadeUp}
            initial="hidden"
            animate="show"
            custom={0.6 + i * 0.08}
            className="flex flex-col items-center gap-2 rounded-xl border border-line bg-raised/40 px-1 py-3.5 text-center text-[11.5px] text-soft"
          >
            <Icon as={tile.icon} size={17} className="text-fg" />
            {t(tile.key)}
          </m.div>
        ))}
      </div>
    </Frame>
  )
}
