import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, ApiError } from '@/api/client'
import type { BusyReason, UninstallPlan } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Button, Card, Modal } from '@/components/ui'
import { player } from '@/features/player/store'
import { BusyList, useBusyReasons } from './busy'

/** Settings → Interface: delete the app. Lessons stay unless the user ticks them too. */
export function UninstallCard() {
  const { t, openModal } = useUI()
  return (
    <Card title={t('uninstall.title')} description={t('uninstall.hint')}>
      <Button variant="danger" icon={Trash2} onClick={() => openModal((close) => <UninstallDialog close={close} />)}>
        {t('uninstall.button')}
      </Button>
    </Card>
  )
}

/**
 * Shows what goes and what stays, then hands over to the OS uninstaller: it waits for the server to stop, deletes
 * the app and says what was kept. Nothing to wait for here — the window is closed by the uninstaller.
 */
function UninstallDialog({ close }: { close: () => void }) {
  const { t, toast } = useUI()
  const [plan, setPlan] = useState<UninstallPlan | null>(null)
  const [reasons, setReasons] = useBusyReasons()
  const [deleteLessons, setDeleteLessons] = useState(false)
  const [understood, setUnderstood] = useState(false)
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    api.uninstallPlan().then(setPlan, (e: Error) => toast(e.message, 'error'))
  }, [toast])

  const busy = Boolean(reasons?.length)
  const lessonsBlock = Boolean(plan?.lessons_inside && !deleteLessons)
  const blocked = !plan || Boolean(plan.blocked) || lessonsBlock || busy || reasons === null

  async function run() {
    setRunning(true)
    try {
      await api.uninstall(deleteLessons)
      player.unload()
      setDone(true)
    } catch (e) {
      const detail = e instanceof ApiError ? (e.detail as { reasons?: BusyReason[] }) : null
      if (detail?.reasons) setReasons(detail.reasons)
      else toast((e as Error).message, 'error')
      setRunning(false)
    }
  }

  const reinstall = plan
    ? plan.reinstall === 'git'
      ? t('uninstall.reinstallGit', { url: plan.repo_url, path: plan.app_dir })
      : t('uninstall.reinstallSetup')
    : ''

  if (done) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-bg px-6 text-center">
        <span className="flex size-14 items-center justify-center rounded-full border border-line-strong">
          <Icon as={Trash2} size={22} />
        </span>
        <h1 className="text-[18px] font-semibold">{t('uninstall.doneTitle')}</h1>
        <p className="max-w-md text-[13.5px] text-muted">{t('uninstall.doneHint')}</p>
        <p className="max-w-md font-mono text-[12px] break-all text-soft">{reinstall}</p>
      </div>
    )
  }

  return (
    <Modal
      title={t('uninstall.dialogTitle')}
      width="md"
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>{t('common.cancel')}</Button>
          <Button variant="danger" icon={Trash2} disabled={blocked || !understood} loading={running} onClick={run}>
            {t('uninstall.apply')}
          </Button>
        </>
      }
    >
      {!plan || reasons === null ? (
        <p className="animate-pulse-soft text-[13px] text-muted">{t('system.checking')}</p>
      ) : (
        <div className="flex flex-col gap-4 text-[13.5px] leading-relaxed text-soft">
          <div className="flex flex-col gap-1.5">
            <p className="text-fg">{t('uninstall.removes')}</p>
            <ul className="flex flex-col gap-1 text-[13px] break-all">
              <li>{t('uninstall.appDir', { path: plan.app_dir })}</li>
              <li>{t('uninstall.settingsDir', { path: plan.settings_dir })}</li>
              <li>{t('uninstall.shortcut')}</li>
            </ul>
          </div>
          {!deleteLessons && !plan.lessons_inside && <p className="break-all">{t('uninstall.lessonsKept', { path: plan.data_dir })}</p>}
          <label className="flex cursor-pointer items-start gap-2.5 text-[13px] text-fg">
            <input type="checkbox" checked={deleteLessons} onChange={(e) => setDeleteLessons(e.target.checked)} className="mt-[3px] size-3.5 accent-fg" />
            <span>{t('uninstall.deleteLessons')}</span>
          </label>
          {plan.blocked === 'git_work' && (
            <div className="flex flex-col gap-2 rounded-lg border border-line-strong px-3 py-2.5 text-[13px]">
              <p>{t('uninstall.gitWork')}</p>
              <ul className="flex max-h-32 flex-col gap-0.5 overflow-y-auto font-mono text-[12px] text-muted">
                {plan.git_files.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
          {lessonsBlock && <p className="rounded-lg border border-line-strong px-3 py-2.5 text-[13px]">{t('uninstall.lessonsInside')}</p>}
          {busy && <BusyList reasons={reasons} />}
          <p className="font-mono text-[12px] break-all text-muted">{reinstall}</p>
          <label className="flex cursor-pointer items-start gap-2.5 text-[13px] text-fg">
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-[3px] size-3.5 accent-fg" />
            <span>{t('uninstall.confirm')}</span>
          </label>
        </div>
      )}
    </Modal>
  )
}
