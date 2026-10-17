import { Power } from 'lucide-react'
import { useState } from 'react'
import { api, ApiError } from '@/api/client'
import type { BusyReason } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Button, Modal } from '@/components/ui'
import { player } from '@/features/player/store'
import { SidebarAction } from '@/layouts/Sidebar'
import { BusyList, useBusyReasons } from './busy'

/**
 * Sidebar power button. Shuts the local server down only when nothing is running:
 * the server re-checks atomically, this dialog just explains and warns.
 */
export function ShutdownButton() {
  const { t, openModal } = useUI()
  return <SidebarAction icon={Power} label={t('nav.shutdown')} onClick={() => openModal((close) => <ShutdownDialog close={close} />)} />
}

function ShutdownDialog({ close }: { close: () => void }) {
  const { t, setStopped, toast } = useUI()
  const [reasons, setReasons] = useBusyReasons()
  const [stopping, setStopping] = useState(false)

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
        <BusyList reasons={reasons} />
      ) : (
        <p className="text-[13.5px] leading-relaxed text-soft">{t('system.shutdownText')}</p>
      )}
    </Modal>
  )
}
