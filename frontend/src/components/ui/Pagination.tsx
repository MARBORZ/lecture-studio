import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useUI } from '@/app/AppProvider'
import { IconButton } from './Button'

/** Pages of a long list: ‹ page X of Y ›. Renders nothing for a single page. */
export function Pagination({ page, size, total, onPage }: { page: number; size: number; total: number; onPage: (p: number) => void }) {
  const { t } = useUI()
  const pages = Math.max(1, Math.ceil(total / size))
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-center gap-2 pt-1">
      <IconButton icon={ChevronLeft} size="sm" label={t('common.prevPage')} disabled={page <= 1} onClick={() => onPage(page - 1)} />
      <span className="font-mono text-[12px] text-muted tabular-nums">{t('common.pageOf', { page, pages })}</span>
      <IconButton icon={ChevronRight} size="sm" label={t('common.nextPage')} disabled={page >= pages} onClick={() => onPage(page + 1)} />
    </div>
  )
}
