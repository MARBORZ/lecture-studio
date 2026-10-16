import { useState } from 'react'
import { useUI } from '@/app/AppProvider'
import { Button, Card, Slider } from '@/components/ui'

const PRESETS = [5, 10, 20, 50]

/** Settings → Processing: how many jobs may wait and run (one worker, in order); more are refused by the server. */
export function QueueLimitCard() {
  const { t, settings, patchSettings, toast } = useUI()
  const saved = settings!.queue_limit
  const [draft, setDraft] = useState<number | null>(null)
  const value = draft ?? saved
  const save = (v: number) => patchSettings({ queue_limit: v }).catch((e: Error) => toast(e.message, 'error'))
  const commit = () => {
    if (draft !== null && draft !== saved) void save(draft)
    setDraft(null)
  }
  return (
    <Card title={t('settings.queueLimit')} description={t('settings.queueLimitHint')} fold="processing.queue" summary={t('settings.queueLimit.jobs', { n: saved })}>
      <div className="flex flex-col gap-4" onPointerUp={commit} onKeyUp={commit}>
        <Slider value={value} min={1} max={100} step={1} format={(v) => t('settings.queueLimit.jobs', { n: v })} onChange={setDraft} />
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((v) => (
            <Button key={v} size="sm" variant={value === v ? 'primary' : 'secondary'} onClick={() => void save(v)}>
              {v}
            </Button>
          ))}
        </div>
      </div>
    </Card>
  )
}
