/**
 * Monochrome mini-mockups for the tutorial. Built from the app's own primitives and i18n keys,
 * so they look like the real screens and switch language with them.
 */
import { Check, Clapperboard, Library, MessagesSquare, NotebookPen, Play, Power, ScrollText, Scissors, Settings, Upload } from 'lucide-react'
import type { ReactNode } from 'react'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Progress, StatusMark } from '@/components/ui'
import { KeyField } from '@/features/system/KeyField'
import { SECTIONS } from '@/pages/settings/SettingsLayout'
import { m } from '@/components/motion'
import { cn } from '@/lib/cn'
import { ease, fadeUp, springBouncy } from '@/lib/motion'

/** Same box on every step (fixed min height, content centred), so steps do not jump. */
function Frame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="flex min-h-[340px] w-full max-w-[480px] flex-col justify-center rounded-2xl border border-line-strong bg-surface p-6 shadow-2xl">
      <div className={cn('w-full', className)}>{children}</div>
    </div>
  )
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
      <svg viewBox="0 0 64 64" className="size-16" aria-hidden>
        <path d="M18 16v32h28" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="square" />
        <path d="M30 24l14 8-14 8z" fill="currentColor" />
      </svg>
      <div className="flex w-full max-w-xs flex-col gap-3">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded-lg border border-line"><Icon as={r.icon} size={15} /></span>
            <span className={cn('h-2 rounded-full bg-line-strong', r.w)} />
          </div>
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
        {lessons.map((l) => (
          <div key={l.title} className="flex items-center gap-3 px-3 py-2.5 text-[12.5px]">
            <StatusMark status={l.status} />
            <span className="flex-1 truncate text-fg">{l.title}</span>
            <span className="text-[11px] text-muted">{t(`status.${l.status}`)}</span>
          </div>
        ))}
      </div>
    </Frame>
  )
}

export function StudioArt() {
  const { t } = useUI()
  const stages = ['extract', 'vad', 'audio', 'video', 'transcribe', 'audit'] as const
  return (
    <Frame className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong py-6 text-[12.5px] text-soft">
        <Icon as={Upload} size={18} />
        {t('studio.drop')}
      </div>
      <div className="rounded-xl border border-line p-3">
        <div className="mb-2 flex justify-between text-[12px]"><span className="text-fg">Lecture_03.mov</span><span className="font-mono">64%</span></div>
        <Progress value={64} />
        <div className="mt-3 flex flex-wrap gap-1.5">
          {stages.map((s, i) => (
            <span key={s} className={cn('flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]', i < 4 ? 'border-line-strong text-soft' : i === 4 ? 'border-fg text-fg' : 'border-line text-dim')}>
              {i < 4 && <Icon as={Check} size={11} />}
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
  return (
    <Frame className="flex flex-col gap-3">
      <div className="flex aspect-video items-center justify-center rounded-xl border border-line bg-black">
        <span className="flex size-11 items-center justify-center rounded-full bg-fg text-bg"><Icon as={Play} size={18} fill="currentColor" strokeWidth={0} className="translate-x-[1px]" /></span>
      </div>
      <div className="relative h-1 rounded-full bg-line">
        <div className="absolute inset-y-0 left-0 w-[38%] rounded-full bg-fg" />
        {[18, 38, 61, 83].map((x) => <span key={x} className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-muted" style={{ left: `${x}%` }} />)}
      </div>
      <div className="flex flex-col gap-1.5 text-[12.5px] text-soft">
        <p className="font-semibold text-fg"><Chip>04:15</Chip> {t('onboarding.sample.chapter1')}</p>
        <p className="pl-3">— <Chip>04:42</Chip> {t('onboarding.sample.chapter2')}</p>
      </div>
    </Frame>
  )
}

export function AssistantArt() {
  const { t } = useUI()
  return (
    <Frame className="flex flex-col gap-3 text-[12.5px]">
      <div className="ml-auto max-w-[80%] rounded-xl rounded-br-sm bg-raised px-3 py-2 text-fg">{t('onboarding.assistant.sampleQ')}</div>
      <div className="rounded-xl border border-line p-3 text-soft">
        {t('onboarding.assistant.sampleA')} <Chip>{t('onboarding.sample.citation')} · 00:38</Chip>
        <div className="mt-2 h-1.5 w-3/4 rounded-full bg-line" />
        <div className="mt-1.5 h-1.5 w-1/2 rounded-full bg-line" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(['key_moments', 'pitfalls', 'code_summary', 'quiz', 'chapters'] as const).map((r) => (
          <span key={r} className="rounded-md border border-line-strong px-2 py-0.5 text-[11px] text-soft">{t(`assistant.role.${r}`)}</span>
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
        <div key={i} className="rounded-xl border border-line px-3 py-2.5">
          <p className="text-fg">{s}</p>
          <p className="mt-1 font-mono text-[10.5px] text-dim">{t(i ? 'onboarding.sample.category2' : 'onboarding.sample.category1')} · 14:0{i + 2}</p>
        </div>
      ))}
      <div className="flex items-center gap-2 text-dim"><Icon as={NotebookPen} size={13} /> diary/{t('onboarding.sample.category1')}/2026-10-15 1402.md</div>
    </Frame>
  )
}

export function KeysStep() {
  return (
    <Frame className="flex flex-col gap-6">
      <KeyField provider="deepseek" />
      <KeyField provider="gemini" />
    </Frame>
  )
}

export function SettingsArt() {
  const { t } = useUI()
  return (
    <Frame className="flex flex-col gap-1">
      {SECTIONS.map((s, i) => (
        <span key={s.to} className={cn('flex h-9 items-center gap-3 rounded-lg px-3 text-[13px]', i === 2 ? 'bg-raised text-fg' : 'text-soft')}>
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
      <div className="rounded-xl border border-line-strong p-4">
        <p className="text-[13px] font-semibold text-fg">{t('system.shutdownTitle')}</p>
        <p className="mt-1 text-[12px] leading-snug text-muted">{t('system.shutdownText')}</p>
        <div className="mt-3 flex justify-end gap-2 text-[12px]">
          <span className="rounded-md px-2.5 py-1 text-soft">{t('common.cancel')}</span>
          <span className="flex items-center gap-1.5 rounded-md border border-fg px-2.5 py-1 text-fg"><Icon as={Power} size={12} />{t('nav.shutdown')}</span>
        </div>
      </div>
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
          className="relative flex size-24 items-center justify-center rounded-full bg-fg shadow-[0_0_60px_rgba(255,255,255,0.12)]"
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
