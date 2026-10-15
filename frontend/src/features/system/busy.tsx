import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { BusyReason } from '@/api/types'
import { useJobs, useUI } from '@/app/AppProvider'

/**
 * What keeps the server from going down (shutdown, update): jobs/exports from the server + uploads from this tab.
 * null while loading. The setter takes the reasons from a 409 (the server re-checks atomically).
 */
export function useBusyReasons() {
  const { t } = useUI()
  const { uploads } = useJobs()
  const [reasons, setReasons] = useState<BusyReason[] | null>(null)

  useEffect(() => {
    const local = uploads.map((u) => ({ kind: 'upload', label: `${t('system.localUpload')}: ${u.name}`, progress: Math.round(u.progress * 100) }))
    api.status().then(
      (s) => setReasons([...local, ...s.reasons]),
      () => setReasons(local),
    )
  }, [uploads, t])

  return [reasons, setReasons] as const
}

export function BusyList({ reasons }: { reasons: BusyReason[] }) {
  const { t } = useUI()
  return (
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
  )
}
