import { api } from '@/api/client'
import type { Project } from '@/api/types'
import { cn } from '@/lib/cn'

/** A notebook's picture, or its first letter when it has none. One component for the sidebar, headers and forms. */
export function NotebookCover({ project, src, className, active }: { project: Pick<Project, 'id' | 'name' | 'cover'>; src?: string | null; className?: string; active?: boolean }) {
  const url = src ?? api.coverUrl(project)
  if (url) return <img src={url} alt="" draggable={false} className={cn('shrink-0 rounded-[5px] object-cover', className)} />
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-[5px] border font-semibold uppercase', active ? 'border-fg' : 'border-line-strong', className)}>
      {project.name.trim().charAt(0)}
    </span>
  )
}
