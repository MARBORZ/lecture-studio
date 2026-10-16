import { AlertTriangle, ArrowRight, Check, Cpu, Database, Film, KeyRound, Server } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { ComputeStatus, SystemStatus } from '@/api/types'
import { PROVIDER_NAME } from '@/features/system/KeyNotice'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { AnimatePresence, m } from '@/components/motion'
import { Button } from '@/components/ui'
import { fade, fadeUp, pop } from '@/lib/motion'

/** Rows resolve one after another at this pace even when the answers are instant: readable, not a flash. */
const PACE_MS = 320

/** A long path keeps its end (the meaningful part): …/parent/folder */
const tail = (path: string) => {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return path.length > 32 && parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : path
}

type Row = { id: string; icon: typeof Server; label: string; value: string; ok: boolean }

/**
 * First run, after the language: what this computer is ready for. Real checks — server, FFmpeg, where speech
 * recognition will run, the data folder, AI keys — each resolving with its answer. Nothing here blocks: a missing
 * piece is shown with what it means, and the walkthrough goes on.
 */
export function Bootstrap({ onDone }: { onDone: () => void }) {
  const { t, settings } = useUI()
  const [status, setStatus] = useState<SystemStatus | null | undefined>()
  const [compute, setCompute] = useState<ComputeStatus | null | undefined>()
  const [shown, setShown] = useState(0)

  useEffect(() => {
    api.status().then(setStatus, () => setStatus(null))
    api.compute().then(setCompute, () => setCompute(null))
  }, [])

  const keys = settings ? [...(['deepseek', 'gemini'] as const).filter((p) => settings.ai[`${p}_key`].source !== 'none'), ...(settings.ai.local_model ? ['local' as const] : [])] : []
  const rows: Array<Row | null> = [
    status === undefined ? null : { id: 'server', icon: Server, label: t('onboarding.boot.server'), value: status ? `v${status.version}` : t('onboarding.boot.unknown'), ok: Boolean(status) },
    status === undefined ? null : { id: 'ffmpeg', icon: Film, label: 'FFmpeg', value: status?.ffmpeg ? t('onboarding.boot.ready') : t('onboarding.boot.ffmpegMissing'), ok: Boolean(status?.ffmpeg) },
    compute === undefined
      ? null
      : {
          id: 'compute',
          icon: Cpu,
          label: t('onboarding.boot.compute'),
          value: !compute
            ? t('onboarding.boot.unknown')
            : compute.backend === 'cpu'
              ? t('settings.compute.onCpu', { n: compute.threads })
              : t('settings.compute.onGpu', { name: compute.gpu_name || 'Apple GPU' }),
          ok: Boolean(compute),
        },
    settings ? { id: 'data', icon: Database, label: t('onboarding.boot.data'), value: tail(settings.paths.data_dir), ok: true } : null,
    settings
      ? { id: 'keys', icon: KeyRound, label: t('onboarding.boot.keys'), value: keys.length ? keys.map((k) => (k === 'local' ? t('ai.local.short') : PROVIDER_NAME[k])).join(', ') : t('onboarding.boot.noKeys'), ok: keys.length > 0 }
      : null,
  ]

  // reveal the next row once it is answered, never faster than the pace
  const ready = rows[shown] != null
  useEffect(() => {
    if (shown >= rows.length || !ready) return
    const timer = window.setTimeout(() => setShown((n) => n + 1), PACE_MS)
    return () => window.clearTimeout(timer)
  }, [shown, ready, rows.length])
  const done = shown >= rows.length

  useEffect(() => {
    if (!done) return
    const onKey = (e: KeyboardEvent) => e.key === 'Enter' && onDone()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [done, onDone])

  return (
    <m.div key="boot" variants={fade} initial="hidden" animate="show" exit="exit" className="fixed inset-0 z-[90] flex items-center justify-center bg-bg px-6">
      <div className="flex w-full max-w-lg flex-col gap-8">
        <m.div variants={fadeUp} initial="hidden" animate="show">
          <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-fg">{t('onboarding.boot.title')}</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-muted">{t('onboarding.boot.lead')}</p>
        </m.div>

        <ol className="flex flex-col divide-y divide-line rounded-2xl border border-line-strong bg-surface">
          {rows.map((r, i) => {
            const visible = i < shown && r
            return (
              <li key={i} className="flex h-14 items-center gap-3.5 px-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line text-soft">
                  {r ? <Icon as={r.icon} size={15} /> : <span className="size-1.5 animate-pulse-soft rounded-full bg-muted" />}
                </span>
                <AnimatePresence initial={false}>
                  {visible ? (
                    <m.span key="row" variants={fadeUp} initial="hidden" animate="show" className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="shrink-0 text-[13.5px] text-fg">{visible.label}</span>
                      <span className="min-w-0 flex-1 truncate text-right font-mono text-[12px] text-muted" title={visible.value}>{visible.value}</span>
                      <m.span variants={pop} initial="hidden" animate="show" className="shrink-0">
                        <Icon as={visible.ok ? Check : AlertTriangle} size={15} className={visible.ok ? 'text-fg' : 'text-soft'} />
                      </m.span>
                    </m.span>
                  ) : (
                    <span className="h-2 w-1/3 animate-pulse-soft rounded-full bg-raised" />
                  )}
                </AnimatePresence>
              </li>
            )
          })}
        </ol>

        <div className="flex h-11 items-center justify-end">
          <AnimatePresence>
            {done && (
              <m.div variants={fadeUp} initial="hidden" animate="show">
                <Button variant="primary" size="lg" iconRight={ArrowRight} onClick={onDone} data-autofocus>
                  {t('onboarding.boot.continue')}
                </Button>
              </m.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </m.div>
  )
}
