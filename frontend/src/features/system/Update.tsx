import { CircleArrowUp, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, ApiError } from '@/api/client'
import type { BusyReason, UpdateInfo } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Button, Card, Modal, Switch } from '@/components/ui'
import { useSidebarCollapsed } from '@/layouts/Sidebar'
import { cn } from '@/lib/cn'
import { formatDate, storage } from '@/lib/format'
import { BusyList, useBusyReasons } from './busy'
import { updates, useUpdates } from './updateStore'

const RECHECK_MS = 3 * 60 * 60 * 1000
const GIVE_UP_MS = 25 * 60 * 1000 // a changed torch build (CUDA on Windows) is a multi-GB download

const SHOWN_KEY = 'update.outcomeShown'

/**
 * AppShell: check on start and every few hours; report the result of an update that just happened.
 * The server repeats the outcome for a few minutes (the page reloads more than once around a restart):
 * shown once per outcome, and not while the waiting screen is still up (it is about to reload).
 */
export function useUpdateWatcher() {
  const { t, toast } = useUI()
  useEffect(() => {
    const run = () =>
      updates.check().then(
        (info) => {
          if (!info.last || updates.getState().phase || storage.get(SHOWN_KEY, 0) === info.last.at) return
          storage.set(SHOWN_KEY, info.last.at)
          if (info.last.ok) toast(t('update.done', { v: info.last.to_version }))
          else toast(t('update.rolledBack', { to: info.last.to_version, from: info.last.from_version }), 'error')
        },
        () => undefined,
      )
    void run()
    const id = setInterval(run, RECHECK_MS)
    return () => clearInterval(id)
  }, [t, toast])
}

/** Sidebar: appears only when a release is newer than what runs. */
export function UpdateButton() {
  const { t, openModal } = useUI()
  const collapsed = useSidebarCollapsed()
  const info = useUpdates((s) => s.info)
  if (!info?.available) return null
  const label = t('update.available', { v: info.latest ?? '' })
  return (
    <button
      type="button"
      title={collapsed ? label : undefined}
      onClick={() => openModal((close) => <UpdateDialog close={close} />)}
      className="flex h-9 w-full items-center gap-2.5 overflow-hidden rounded-lg px-[10px] text-[13px] whitespace-nowrap text-fg transition-colors hover:bg-hover"
    >
      <Icon as={CircleArrowUp} size={15} className="shrink-0" />
      <span className={cn('flex-1 text-left transition-opacity duration-200', collapsed && 'opacity-0')}>{label}</span>
      {!collapsed && <span className="size-1.5 shrink-0 rounded-full bg-fg" />}
    </button>
  )
}

/** Settings → Interface: running version, a manual check and the beta channel (always on while a beta runs). */
export function UpdateCard() {
  const { t, lang, toast, openModal, settings, patchSettings } = useUI()
  const info = useUpdates((s) => s.info)
  const checking = useUpdates((s) => s.checking)
  const onBeta = Boolean(info?.current_prerelease)

  async function setBeta(on: boolean) {
    try {
      await patchSettings({ beta_updates: on })
      await updates.check(true) // the sidebar button follows the channel
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  async function check() {
    try {
      const fresh = await updates.check(true)
      if (fresh.error) toast(`${t('update.checkFailed')}: ${fresh.error}`, 'error')
      else if (fresh.available) openModal((close) => <UpdateDialog close={close} />)
      else toast(t('update.upToDate'))
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  return (
    <Card title={t('update.title')} description={currentText(info, t, lang)}>
      <div className="flex flex-col gap-4">
        <Button icon={RefreshCw} loading={checking} onClick={check} className="self-start">{t('update.check')}</Button>
        <Switch
          checked={onBeta || settings!.beta_updates}
          disabled={onBeta}
          onChange={(on) => void setBeta(on)}
          label={t('update.beta')}
          hint={t(onBeta ? 'update.betaRunning' : 'update.betaHint')}
        />
      </div>
    </Card>
  )
}

/** "Installed version 1.3.0 of 15 Oct 2026": the date only when the running release has a tag. */
function currentText(info: UpdateInfo | null, t: ReturnType<typeof useUI>['t'], lang: string): string {
  const date = info?.current_released_at ? formatDate(info.current_released_at, lang) : ''
  return date ? t('update.currentDated', { v: info!.current, date }) : t('update.current', { v: info?.current ?? '…' })
}

function blockText(info: UpdateInfo, t: ReturnType<typeof useUI>['t']): string | null {
  return info.blocked ? t(`update.blocked.${info.blocked}`) : null
}

function UpdateDialog({ close }: { close: () => void }) {
  const { t, lang, toast } = useUI()
  const info = useUpdates((s) => s.info)
  const [reasons, setReasons] = useBusyReasons()
  const [applying, setApplying] = useState(false)
  if (!info?.available) return null

  const blocked = blockText(info, t)
  const busy = Boolean(reasons?.length)

  async function apply() {
    setApplying(true)
    try {
      await updates.apply()
      close()
    } catch (e) {
      const detail = e instanceof ApiError ? (e.detail as { reasons?: BusyReason[] }) : null
      if (detail?.reasons) setReasons(detail.reasons)
      else toast((e as Error).message, 'error')
      setApplying(false)
    }
  }

  return (
    <Modal
      title={t('update.dialogTitle', { v: info.latest ?? '' })}
      description={[info.released_at && t('update.released', { date: formatDate(info.released_at, lang) }), currentText(info, t, lang)]
        .filter(Boolean)
        .join(' · ')}
      width="md"
      onClose={close}
      footer={
        <>
          <Button variant="ghost" icon={ExternalLink} onClick={() => window.open(info.url, '_blank', 'noopener')}>
            {info.mode === 'zip' ? t('update.download') : t('update.notes')}
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" onClick={close}>{t('common.cancel')}</Button>
          {info.mode === 'git' && (
            <Button variant="primary" icon={CircleArrowUp} disabled={reasons === null || busy || Boolean(blocked)} loading={applying} onClick={apply}>
              {t('update.apply')}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {info.changes.length > 0 && (
          <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
            {info.changes.map((c, i) => (
              <li key={i} className="flex gap-2.5 text-[13.5px] text-fg">
                <span className="mt-[9px] size-1 shrink-0 rounded-full bg-muted" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        )}
        {blocked ? (
          <div className="flex flex-col gap-2 rounded-lg border border-line-strong px-3 py-2.5 text-[13px] leading-relaxed text-soft">
            <p>{blocked}</p>
            {info.blocked === 'dirty' && info.dirty_files.length > 0 && (
              <ul className="flex max-h-32 flex-col gap-0.5 overflow-y-auto font-mono text-[12px] text-muted">
                {info.dirty_files.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
          </div>
        ) : busy ? (
          <BusyList reasons={reasons!} />
        ) : (
          info.mode === 'git' && <p className="text-[13px] leading-relaxed text-muted">{t('update.applyHint')}</p>
        )}
      </div>
    </Modal>
  )
}

/**
 * Full screen while the launcher restarts everything. Waits for a server with a different pid, then reloads:
 * the fresh page reports the outcome (updated, or rolled back) through useUpdateWatcher.
 */
export function UpdatingScreen() {
  const { t } = useUI()
  const phase = useUpdates((s) => s.phase)!
  const [stuck, setStuck] = useState(false)
  const [restartFailed, setRestartFailed] = useState(false)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      if (!alive) return
      if (Date.now() - phase.since > GIVE_UP_MS) {
        setStuck(true)
        return
      }
      try {
        const s = await api.status()
        if (s.pid !== phase.pid) {
          updates.finish()
          window.location.reload()
          return
        }
        // The same server still answers: if the launcher never started, it says so (the code is updated, the restart is not).
        if ((await api.update(false)).restart_failed) {
          setRestartFailed(true)
          return
        }
      } catch {
        /* restarting: API or UI server is down for a moment */
      }
      setTimeout(tick, 1500)
    }
    const id = setTimeout(tick, 1500)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [phase])

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-bg px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-full border border-line-strong">
        <Icon as={stuck || restartFailed ? CircleArrowUp : LoaderCircle} size={22} className={stuck || restartFailed ? undefined : 'animate-spin'} />
      </span>
      <h1 className="text-[18px] font-semibold">
        {restartFailed ? t('update.restartFailed') : stuck ? t('update.stuck') : t('update.updating', { v: phase.to })}
      </h1>
      <p className="max-w-sm text-[13.5px] text-muted">
        {restartFailed ? t('update.restartFailedHint', { v: phase.to }) : stuck ? t('update.stuckHint') : t('update.updatingHint')}
      </p>
      {stuck && !restartFailed && (
        <Button onClick={() => { updates.finish(); window.location.reload() }}>{t('update.reload')}</Button>
      )}
    </div>
  )
}
