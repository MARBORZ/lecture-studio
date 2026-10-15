import { Power } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, ApiError } from '@/api/client'
import type { BusyReason } from '@/api/types'
import { useJobs, useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Button, Modal } from '@/components/ui'
import { player } from '@/features/player/store'
import { useSidebarCollapsed } from '@/layouts/Sidebar'
import { cn } from '@/lib/cn'

/**
 * Sidebar power button. Shuts the local server down only when nothing is running:
 * the server re-checks atomically, this dialog just explains and warns.
 */
export function ShutdownButton() {
  const { t, openModal } = useUI()
  const collapsed = useSidebarCollapsed()
  return (
    <button
      type="button"
      title={collapsed ? t('nav.shutdown') : undefined}
      onClick={() => openModal((close) => <ShutdownDialog close={close} />)}
      className="flex h-9 w-full items-center gap-2.5 overflow-hidden rounded-lg px-[10px] text-[13px] whitespace-nowrap text-muted transition-colors hover:bg-hover hover:text-fg"
    >
      <Icon as={Power} size={15} className="shrink-0" />
      <span className={cn('transition-opacity duration-200', collapsed && 'opacity-0')}>{t('nav.shutdown')}</span>
    </button>
  )
}

function ShutdownDialog({ close }: { close: () => void }) {
  const { t, setStopped, toast } = useUI()
  const { uploads } = useJobs()
  const [reasons, setReasons] = useState<BusyReason[] | null>(null)
  const [stopping, setStopping] = useState(false)

  useEffect(() => {
    const local = uploads.map((u) => ({ kind: 'upload', label: `${t('system.localUpload')}: ${u.name}`, progress: Math.round(u.progress * 100) }))
    api.status().then(
      (s) => setReasons([...local, ...s.reasons]),
      () => setReasons(local),
    )
  }, [uploads, t])

  const busy = Boolean(reasons?.length)

  async function shutdown() {
    setStopping(true)
    try {
      await api.shutdown()
      player.unload()
      close()
      setStopped(true)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const detail = e.detail as { reasons?: BusyReason[] }
        setReasons(detail.reasons ?? [])
      } else toast((e as Error).message, 'error')
      setStopping(false)
    }
  }

  return (
    <Modal
      title={busy ? t('system.busyTitle') : t('system.shutdownTitle')}
      width="sm"
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>{t('common.cancel')}</Button>
          <Button variant="danger" icon={Power} disabled={reasons === null || busy} loading={stopping} onClick={shutdown}>
            {t('nav.shutdown')}
          </Button>
        </>
      }
    >
      {reasons === null ? (
        <p className="animate-pulse-soft text-[13px] text-muted">{t('system.checking')}</p>
      ) : busy ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-soft">{t('system.busyText')}</p>
          <ul className="flex flex-col gap-1.5">
            {reasons.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-[13px] text-fg">
                <span className="truncate">{r.label}</span>
                {r.progress != null && <span className="font-mono text-[12px] text-muted">{r.progress}%</span>}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-[13.5px] leading-relaxed text-soft">{t('system.shutdownText')}</p>
      )}
    </Modal>
  )
}
