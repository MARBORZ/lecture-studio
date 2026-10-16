import { ArrowRight, FileVideo, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '@/api/client'
import type { DownloadedVideo } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Button, EmptyState, IconButton, Pagination } from '@/components/ui'
import { SkeletonList } from '@/components/skeleton'
import type { StudioHandoff } from '@/features/jobs/JobList'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/format'
import { useResource } from '@/lib/useResource'

const PAGE = 12

/** Hand a downloaded file to the Studio: the file on disk and its title, the wizard goes on from there. */
export function useToStudio() {
  const navigate = useNavigate()
  return (d: DownloadedVideo) => navigate('/studio', { state: { path: d.path, title: d.title } satisfies StudioHandoff })
}

/**
 * Everything the Videos tab downloaded, newest first, a page at a time. Not used yet = no lesson was made of it:
 * those are marked, so a download nobody processed is not forgotten. Delete removes only the downloaded file.
 */
export function DownloadsList() {
  const { t, lang, toast, confirm } = useUI()
  const toStudio = useToStudio()
  const [page, setPage] = useState(1)
  const res = useResource(() => api.downloads(page, PAGE), [page], { keep: true })
  const data = res.data
  if (!data) return <SkeletonList rows={4} />
  if (data.total === 0) return <EmptyState icon={FileVideo} title={t('videos.downloadedEmpty')} hint={t('videos.downloadedEmptyHint')} />
  return (
    <div className="flex flex-col gap-3">
      <div className="divide-y divide-line rounded-xl border border-line bg-surface">
        {data.items.map((d) => (
          <div key={d.name} className="group flex items-center gap-3 px-4 py-3">
            <Icon as={FileVideo} size={16} className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] text-fg">{d.title}</span>
              <span className="block truncate text-[11.5px] text-muted">
                {formatDateTime(d.downloaded_at, lang)} · {d.size_mb} MB
              </span>
            </span>
            <span className={cn('shrink-0 rounded-md border px-1.5 py-0.5 text-[11px]', d.used ? 'border-line text-dim' : 'border-fg text-fg')}>
              {d.used ? t('videos.used') : t('videos.unused')}
            </span>
            <Button size="sm" variant={d.used ? 'ghost' : 'secondary'} iconRight={ArrowRight} onClick={() => toStudio(d)}>
              {t('videos.toStudio')}
            </Button>
            <IconButton
              icon={Trash2}
              size="sm"
              label={t('common.delete')}
              className="opacity-0 transition-opacity group-hover:opacity-100"
              onClick={async () => {
                if (!(await confirm({ title: `${t('common.delete')}: ${d.title}`, text: t('videos.deleteText'), danger: true, confirmLabel: t('common.delete') }))) return
                try {
                  await api.deleteDownload(d.name)
                  if (data.items.length === 1 && page > 1) setPage(page - 1)
                  else await res.reload()
                } catch (e) {
                  toast((e as Error).message, 'error')
                }
              }}
            />
          </div>
        ))}
      </div>
      <Pagination page={data.page} size={data.size} total={data.total} onPage={setPage} />
    </div>
  )
}

/**
 * The Studio's first step: videos downloaded in the Videos tab that no lesson was made of yet — the few newest,
 * one click takes one. Nothing is shown when there are none.
 */
export function UnusedDownloads() {
  const { t, lang } = useUI()
  const toStudio = useToStudio()
  const res = useResource(() => api.downloads(1, 4, true), [])
  const data = res.data
  if (!data?.total) return null
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="label-caps">{t('studio.unusedDownloads', { n: data.total })}</h3>
        <Link to="/videos?tab=downloads" className="text-[12px] text-muted hover:text-fg">{t('studio.allDownloads')}</Link>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {data.items.map((d) => (
          <button
            key={d.name}
            type="button"
            onClick={() => toStudio(d)}
            className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-left transition-colors hover:border-line-strong"
          >
            <Icon as={FileVideo} size={15} className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-fg">{d.title}</span>
              <span className="block truncate text-[11.5px] text-muted">{formatDateTime(d.downloaded_at, lang)} · {d.size_mb} MB</span>
            </span>
            <Icon as={ArrowRight} size={14} className="shrink-0 text-dim" />
          </button>
        ))}
      </div>
    </section>
  )
}
