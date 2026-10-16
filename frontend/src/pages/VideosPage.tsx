import { Link2, MonitorPlay, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { api } from '@/api/client'
import type { VideoItem } from '@/api/types'
import { useJobs, useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Button, EmptyState, Input, Page, PageHeader, Segmented } from '@/components/ui'
import { DownloadsList } from '@/features/videos/DownloadsList'
import { Skeleton } from '@/components/skeleton'
import { JobList } from '@/features/jobs/JobList'
import { VideoModal } from '@/features/videos/VideoModal'
import { VideoCard } from '@/features/videos/youtube'

/**
 * Videos: search YouTube or paste a link, watch it here, download it for the Studio (yt-dlp on this computer).
 * Downloads run in the common queue; a finished one opens the Studio with the file and the title filled in.
 */
export function VideosPage() {
  const { t, toast, openModal } = useUI()
  const { jobs } = useJobs()
  const [query, setQuery] = useState('')
  const [link, setLink] = useState('')
  const [results, setResults] = useState<VideoItem[] | null>(null)
  const [searching, setSearching] = useState(false)
  // more results: the next page is asked for when the end of the grid comes into view (or by the button)
  const [asked, setAsked] = useState({ q: '', page: 1, more: true, failed: false })
  const [loadingMore, setLoadingMore] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  // the tab lives in the URL (?tab=downloads): a link from the Studio opens it, back/forward keep it
  const [params, setParams] = useSearchParams()
  const tab: 'search' | 'downloads' = params.get('tab') === 'downloads' ? 'downloads' : 'search'
  const setTab = (v: 'search' | 'downloads') => setParams(v === 'search' ? {} : { tab: v }, { replace: true })
  const [opening, setOpening] = useState(false)
  const downloads = jobs.filter((j) => j.kind === 'download')

  const open = (video: VideoItem) => openModal((close) => <VideoModal video={video} close={close} />)

  const search = async () => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    try {
      const first = await api.searchVideos(q, 1)
      setResults(first)
      setAsked({ q, page: 1, more: first.length > 0, failed: false })
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setSearching(false)
    }
  }

  const loadMore = async (retry = false) => {
    if (loadingMore || !asked.more || (asked.failed && !retry) || !asked.q) return
    setLoadingMore(true)
    try {
      const next = await api.searchVideos(asked.q, asked.page + 1)
      setResults((r) => {
        const seen = new Set((r ?? []).map((v) => v.id))
        return [...(r ?? []), ...next.filter((v) => !seen.has(v.id))]
      })
      setAsked((a) => ({ ...a, page: a.page + 1, more: next.length > 0, failed: false }))
    } catch (e) {
      toast((e as Error).message, 'error')
      setAsked((a) => ({ ...a, failed: true })) // no endless retries by scrolling: the button below asks again
    } finally {
      setLoadingMore(false)
    }
  }

  // the end of the grid in view: the next page
  useEffect(() => {
    const el = endRef.current
    if (!el || !results?.length) return
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && void loadMore(), { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }) // re-armed after every render: loadMore reads the current page

  const openLink = async () => {
    if (!link.trim()) return
    setOpening(true)
    try {
      const info = await api.videoInfo(link.trim())
      open(info)
      setLink('')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setOpening(false)
    }
  }

  return (
    <Page width="lg" className="flex flex-col gap-6">
        <PageHeader title={t('videos.title')} subtitle={t('videos.lead')} />

        <div className="grid gap-3 md:grid-cols-[1fr_minmax(0,22rem)]">
          <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), void search())}>
            <div className="relative flex-1">
              <Icon as={Search} size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-dim" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('videos.searchPlaceholder')} className="pl-9" autoFocus />
            </div>
            <Button type="submit" variant="primary" loading={searching} disabled={!query.trim()}>{t('videos.search')}</Button>
          </form>
          <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), void openLink())}>
            <div className="relative flex-1">
              <Icon as={Link2} size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-dim" />
              <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder={t('videos.linkPlaceholder')} className="pl-9 font-mono text-[12.5px]" spellCheck={false} />
            </div>
            <Button type="submit" loading={opening} disabled={!link.trim()}>{t('videos.openLink')}</Button>
          </form>
        </div>

        {downloads.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="label-caps">{t('videos.downloads')}</h2>
            <JobList jobs={downloads} tools={false} />
          </section>
        )}

        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'search', label: t('videos.tab.search') },
            { value: 'downloads', label: t('videos.tab.downloaded') },
          ]}
        />
        {tab === 'downloads' ? (
          <DownloadsList />
        ) : (
        <>

        {searching ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className="aspect-video rounded-xl" />
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : results === null ? (
          <EmptyState icon={MonitorPlay} title={t('videos.emptyTitle')} hint={t('videos.emptyText')} />
        ) : results.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-muted">{t('videos.nothing')}</p>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="grid gap-x-5 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {results.map((v) => <VideoCard key={v.id} video={v} onOpen={() => open(v)} />)}
            </div>
            <div ref={endRef} className="flex justify-center">
              {/* the next page loads by itself near the end: this only says so (or offers a retry after a failure) */}
              {asked.failed ? (
                <Button variant="ghost" onClick={() => void loadMore(true)}>{t('videos.retryMore')}</Button>
              ) : loadingMore ? (
                <span className="animate-pulse-soft text-[12.5px] text-muted">{t('videos.loadingMore')}</span>
              ) : !asked.more ? (
                <span className="text-[12px] text-dim">{t('videos.noMore')}</span>
              ) : (
                <span className="h-6" />
              )}
            </div>
          </div>
        )}
        </>
        )}
    </Page>
  )
}
