import { ArrowLeft } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useLibrary, useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { EmptyState, StatusMark } from '@/components/ui'
import { AssistantPanel } from '@/features/assistant/AssistantPanel'
import { cn } from '@/lib/cn'
import { storage } from '@/lib/format'

/** NotebookLM: pick sources on the left, grounded chat on the right. */
export function NotebookChatPage() {
  const { projectId = '' } = useParams()
  const { t } = useUI()
  const { projects, lessons } = useLibrary()
  const project = projects.find((p) => p.id === projectId)
  const sources = useMemo(() => lessons.filter((l) => l.project_id === projectId && l.has_transcription), [lessons, projectId])
  const key = `sources.${projectId}`
  const [state, setState] = useState(() => ({ key, ids: storage.get<string[] | null>(key, null) }))
  if (state.key !== key) setState({ key, ids: storage.get<string[] | null>(key, null) }) // notebook changed
  const selected = state.ids
  // stored ids can outlive their lessons (deleted, moved): only current sources count
  const effective = selected ? selected.filter((id) => sources.some((s) => s.id === id)) : sources.map((s) => s.id)
  const update = (ids: string[]) => {
    setState({ key, ids })
    storage.set(key, ids)
  }

  if (!project) return <EmptyState icon={ArrowLeft} title={t('error.notFound')} />

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-line xl:w-72">
        <div className="px-5 pt-6 pb-4">
          <Link to={`/library/${projectId}`} className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-fg">
            <Icon as={ArrowLeft} size={14} />
            {project.name}
          </Link>
          <div className="flex items-baseline justify-between">
            <h2 className="text-[15px] font-semibold">{t('assistant.sources')}</h2>
            <span className="font-mono text-[12px] text-muted">{effective.length}/{sources.length}</span>
          </div>
          <p className="mt-0.5 text-[12px] text-muted">{t('assistant.sourcesHint')}</p>
          <div className="mt-3 flex gap-3 text-[12px]">
            <button type="button" className="text-soft hover:text-fg" onClick={() => update(sources.map((s) => s.id))}>{t('assistant.selectAll')}</button>
            <button type="button" className="text-soft hover:text-fg" onClick={() => update([])}>{t('assistant.selectNone')}</button>
          </div>
        </div>
        <ul className="scroll-area flex-1 px-3 pb-4">
          {sources.map((s) => {
            const on = effective.includes(s.id)
            return (
              <li key={s.id}>
                <label className={cn('flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-[13px] hover:bg-surface', on ? 'text-fg' : 'text-muted')}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => update(on ? effective.filter((x) => x !== s.id) : [...effective, s.id])}
                    className="size-3.5 accent-fg"
                  />
                  <StatusMark status={s.status ?? 'in_progress'} />
                  <span className="truncate">{s.title}</span>
                </label>
              </li>
            )
          })}
        </ul>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col px-6 py-6 lg:px-10">
        <h1 className="mb-4 text-[18px] font-semibold tracking-[-0.01em]">{t('library.chat')}</h1>
        <AssistantPanel kind="project" id={projectId} sources={effective} />
      </section>
    </div>
  )
}
