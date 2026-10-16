import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/api/client'
import type { DownloaderInfo } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Button, Card } from '@/components/ui'
import { useResource } from '@/lib/useResource'

/**
 * Settings → Processing: the video downloader (yt-dlp) — its version, the newest one on PyPI, and an update.
 * YouTube changes often and breaks old versions; the update goes into this app's environment only.
 */
export function DownloaderCard() {
  const { t, toast } = useUI()
  const loaded = useResource(() => api.downloader(), [])
  const [fresh, setFresh] = useState<DownloaderInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const info = fresh ?? loaded.data

  const update = async () => {
    setBusy(true)
    try {
      const next = await api.updateDownloader()
      setFresh(next)
      toast(t('videos.updated', { version: next.version }))
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const status = !info
    ? t('videos.downloaderChecking')
    : !info.version
      ? t('videos.downloaderMissing')
      : info.update_available
        ? t('videos.downloaderOld', { version: info.version, latest: info.latest })
        : info.latest
          ? t('videos.downloaderFresh', { version: info.version })
          : t('videos.downloaderVersion', { version: info.version })

  return (
    <Card title={t('videos.downloader')} description={t('videos.downloaderHint')}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 font-mono text-[12.5px] text-soft">{status}</span>
        <Button icon={RefreshCw} loading={busy} variant={info?.update_available ? 'primary' : 'secondary'} onClick={() => void update()}>
          {t('videos.update')}
        </Button>
      </div>
    </Card>
  )
}
