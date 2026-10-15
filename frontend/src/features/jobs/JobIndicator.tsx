import { NavLink } from 'react-router'
import { useJobs, useUI } from '@/app/AppProvider'
import { Progress } from '@/components/ui'
import { useSidebarCollapsed } from '@/layouts/Sidebar'

/** Sidebar strip: active jobs and in-tab uploads at a glance. */
export function JobIndicator() {
  const { t } = useUI()
  const { activeJobs, uploads } = useJobs()
  const collapsed = useSidebarCollapsed()
  if (!activeJobs.length && !uploads.length) return null
  if (collapsed) {
    // Compact: one number = overall progress of everything running.
    const items = [...uploads.map((u) => u.progress * 100), ...activeJobs.map((j) => j.progress ?? 0)]
    const avg = Math.round(items.reduce((a, b) => a + b, 0) / items.length)
    return (
      <NavLink to="/studio" title={`${t('studio.queue')}: ${avg}%`} className="mx-3 mb-2 flex shrink-0 flex-col items-center gap-1.5 rounded-lg border border-line bg-surface py-2 hover:border-line-strong">
        <span className="font-mono text-[10.5px] text-fg">{avg}%</span>
        <Progress value={avg} className="w-6" />
      </NavLink>
    )
  }
  return (
    <NavLink to="/studio" className="mx-3 mb-2 flex flex-col gap-2 rounded-lg border border-line bg-surface p-2.5 hover:border-line-strong">
      {uploads.map((u) => (
        <div key={u.id} className="flex flex-col gap-1.5">
          <div className="flex justify-between gap-2 text-[11.5px]">
            <span className="truncate text-soft">{t('studio.uploading')}</span>
            <span className="font-mono text-fg">{Math.round(u.progress * 100)}%</span>
          </div>
          <Progress value={u.progress * 100} />
        </div>
      ))}
      {activeJobs.map((j) => (
        <div key={j.id} className="flex flex-col gap-1.5">
          <div className="flex justify-between gap-2 text-[11.5px]">
            <span className="truncate text-soft">{j.title}</span>
            <span className="font-mono text-fg">{j.progress}%</span>
          </div>
          <Progress value={j.progress ?? 0} />
        </div>
      ))}
    </NavLink>
  )
}
