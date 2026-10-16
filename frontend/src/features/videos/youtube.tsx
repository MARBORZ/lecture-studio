import { Play } from 'lucide-react'
import type { VideoItem } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/cn'
import { formatCount } from '@/lib/format'
import { formatTc } from '@/lib/time'

/**
 * YouTube's own embedded player, on youtube-nocookie.com (no cookies until playback). Loaded by the browser straight
 * from YouTube: the app's server is not involved. YouTube asks for the page's origin as the referrer.
 */
export function YouTubePlayer({ id, title, className }: { id: string; title: string; className?: string }) {
  return (
    <iframe
      src={`https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`}
      title={title}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
      referrerPolicy="strict-origin-when-cross-origin"
      allowFullScreen
      className={cn('aspect-video w-full rounded-xl border border-line bg-raised', className)}
    />
  )
}

/** One search result: the thumbnail (i.ytimg.com, straight from YouTube), title, channel, length, views. */
export function VideoCard({ video, onOpen }: { video: VideoItem; onOpen: () => void }) {
  const { t, lang } = useUI()
  return (
    <button type="button" onClick={onOpen} className="group flex flex-col gap-2 rounded-xl text-left focus-visible:outline-2 focus-visible:outline-fg">
      <span className="relative block aspect-video overflow-hidden rounded-xl border border-line bg-raised">
        {video.thumbnail && <img src={video.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover grayscale-[15%] transition-transform duration-300 group-hover:scale-[1.03]" />}
        <span className="absolute inset-0 flex items-center justify-center bg-bg/0 transition-colors group-hover:bg-bg/30">
          <span className="flex size-10 items-center justify-center rounded-full bg-fg text-bg opacity-0 transition-opacity group-hover:opacity-100">
            <Icon as={Play} size={16} fill="currentColor" strokeWidth={0} className="translate-x-[1px]" />
          </span>
        </span>
        {video.duration != null && (
          <span className="absolute right-1.5 bottom-1.5 rounded-md bg-bg/85 px-1.5 py-0.5 font-mono text-[11px] text-fg">{formatTc(video.duration)}</span>
        )}
      </span>
      <span className="line-clamp-2 text-[13px] leading-snug font-medium text-fg">{video.title}</span>
      <span className="-mt-1 truncate text-[12px] text-muted">
        {[video.channel, video.views != null ? t('videos.views', { n: formatCount(video.views, lang) }) : ''].filter(Boolean).join(' · ')}
      </span>
    </button>
  )
}
