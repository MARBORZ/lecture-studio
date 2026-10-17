import { useState } from 'react'
import type { PipelineDefaults } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Button, Card } from '@/components/ui'
import { FALLBACK_DEFAULTS, PipelineOptionsFields } from '@/features/jobs/PipelineOptionsFields'
import { QueueLimitCard } from '@/features/jobs/QueueLimitCard'
import { DownloaderCard } from '@/features/videos/DownloaderCard'

/** Settings → Processing: pipeline defaults, the queue, the downloader and recognition compute. */
export function ProcessingSettings() {
  const { t, settings, patchSettings, toast } = useUI()
  const [opts, setOpts] = useState<Required<PipelineDefaults>>({ ...FALLBACK_DEFAULTS, ...settings!.pipeline } as Required<PipelineDefaults>)
  const dirty = JSON.stringify(opts) !== JSON.stringify({ ...FALLBACK_DEFAULTS, ...settings!.pipeline })
  return (
    <div className="flex flex-col gap-6">
      <Card
        title={t('settings.pipelineDefaults')}
        actions={
          <Button size="sm" variant="primary" disabled={!dirty} onClick={() => patchSettings({ pipeline: opts }).then(() => toast(t('common.saved')), (e) => toast(e.message, 'error'))}>
            {t('common.save')}
          </Button>
        }
      >
        <PipelineOptionsFields value={opts} onChange={setOpts} />
      </Card>
      <QueueLimitCard />
      <DownloaderCard />
    </div>
  )
}
