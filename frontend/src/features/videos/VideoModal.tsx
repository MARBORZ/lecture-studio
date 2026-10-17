import { Download } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/api/client'
import type { VideoItem } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Button, Checkbox, Modal } from '@/components/ui'
import { formatDate } from '@/lib/format'
import { formatTc } from '@/lib/time'
import { useResource } from '@/lib/useResource'
import { YouTubePlayer } from './youtube'

/**
 * One video: YouTube's player, its details (date, license — useful to judge the rights) and "Download and process".
 * The first download asks once for the rights notice (settings.video_terms_accepted).
 */
export function VideoModal({ video, close }: { video: VideoItem; close: () => void }) {
  const { t, lang, settings, patchSettings, toast } = useUI()
  const details = useResource(() => api.videoInfo(video.url), [video.url])
  const [agree, setAgree] = useState(false)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const info = details.data
  const accepted = settings?.video_terms_accepted ?? false

  const download = async () => {
    if (!accepted && !asking) return setAsking(true)
    setBusy(true)
    try {
      if (!accepted) await patchSettings({ video_terms_accepted: true })
      await api.downloadVideo(video.url, info?.title ?? video.title)
      toast(t('videos.started'))
      close()
    } catch (e) {
      toast((e as Error).message, 'error')
      setBusy(false)
    }
  }

  const facts = [
    info?.channel || video.channel,
    video.duration != null ? formatTc(video.duration) : '',
    info?.upload_date ? formatDate(info.upload_date, lang) : '',
  ].filter(Boolean)

  return (
    <Modal
      title={info?.title ?? video.title}
      description={facts.join(' · ')}
      width="lg"
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>{t('common.close')}</Button>
          <Button variant="primary" icon={Download} loading={busy} disabled={(asking && !agree) || info?.is_live} onClick={() => void download()}>
            {t('videos.download')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <YouTubePlayer id={video.id} title={video.title} />
        {details.error && <p className="text-[12.5px] text-fg">{details.error.message}</p>}
        {info?.license && <p className="text-[12.5px] text-soft">{t('videos.license', { license: info.license })}</p>}
        {info?.age_limit ? <p className="text-[12.5px] text-fg">{t('videos.ageLimit', { n: info.age_limit })}</p> : null}
        {info?.description && <p className="line-clamp-4 text-[12.5px] whitespace-pre-line text-muted">{info.description}</p>}
        <p className="text-[12px] text-dim">{t('videos.downloadHint')}</p>
        {asking && (
          <Checkbox checked={agree} onChange={setAgree} className="gap-3 rounded-xl border border-fg px-4 py-3">{t('videos.terms')}</Checkbox>
        )}
      </div>
    </Modal>
  )
}
