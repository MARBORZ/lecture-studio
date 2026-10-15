import { Clapperboard, Inbox, MessagesSquare, Pencil, Search, Trash2 } from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { LessonStatus } from '@/api/types'
import { useLibrary, useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { AnimatePresence, ListItem } from '@/components/motion'
import { Button, EmptyState, IconButton, Page, PageHeader, Segmented } from '@/components/ui'
import { SkeletonList } from '@/components/skeleton'
import { LessonRow } from '@/features/library/LessonRow'
import { ProjectFormModal } from '@/features/library/modals'
import { KeyNotice } from '@/features/system/KeyNotice'

type Filter = 'all' | LessonStatus
const INBOX = 'proj_inbox'

export function LibraryPage() {
  const { projectId } = useParams()
  const { t, openModal, confirm, toast } = useUI()
  const { projects, lessons, loading, deleteProject, projectName } = useLibrary()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const q = useDeferredValue(query.trim().toLowerCase())

  const project = projectId ? projects.find((p) => p.id === projectId) : undefined
  const visible = useMemo(
    () =>
      lessons.filter(
        (l) =>
          (!projectId || l.project_id === projectId) &&
          (filter === 'all' || l.status === filter) &&
          (!q || `${l.title}\n${l.notes}\n${l.tags}`.toLowerCase().includes(q)),
      ),
    [lessons, projectId, filter, q],
  )
  const inScope = projectId ? lessons.filter((l) => l.project_id === projectId).length : lessons.length

  return (
    <Page>
      <PageHeader
        eyebrow={project ? t('common.notebook') : undefined}
        title={project?.name ?? t('library.title')}
        subtitle={project?.description}
        actions={
          project && (
            <>
              <Link to={`/notebooks/${project.id}/chat`}>
                <Button icon={MessagesSquare} variant="primary" disabled={!inScope}>{t('library.chat')}</Button>
              </Link>
              <IconButton icon={Pencil} label={t('library.rename')} onClick={() => openModal((close) => <ProjectFormModal project={project} close={close} />)} />
              {project.id !== INBOX && (
                <IconButton
                  icon={Trash2}
                  label={t('library.deleteNotebook')}
                  onClick={async () => {
                    if (await confirm({ title: `${t('library.deleteNotebook')}: ${project.name}`, text: t('library.deleteNotebookText'), danger: true, confirmLabel: t('common.delete') })) {
                      await deleteProject(project.id).catch((e) => toast(e.message, 'error'))
                      navigate('/library')
                    }
                  }}
                />
              )}
            </>
          )
        }
      />

      <KeyNotice className="mb-4" />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Icon as={Search} size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-dim" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('library.searchPlaceholder')}
            className="h-9 w-full rounded-lg border border-line bg-surface pr-3 pl-8 text-[13.5px] text-fg placeholder:text-dim focus:border-fg focus:outline-none"
          />
        </div>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={(['all', 'in_progress', 'to_review', 'completed'] as const).map((s) => ({ value: s, label: t(`status.${s}`) }))}
        />
      </div>

      {loading ? (
        <SkeletonList />
      ) : !inScope ? (
        <EmptyState
          icon={project?.id === INBOX ? Inbox : Clapperboard}
          title={t('library.empty')}
          hint={t('library.emptyHint')}
          action={<Link to="/studio"><Button variant="primary" icon={Clapperboard}>{t('library.toStudio')}</Button></Link>}
        />
      ) : !visible.length ? (
        <EmptyState icon={Search} title={t('library.noMatch')} />
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          <AnimatePresence initial={true}>
            {visible.map((l, i) => (
              <ListItem key={l.id} index={i}>
                <LessonRow lesson={l} notebook={projectId ? undefined : projectName(l.project_id ?? INBOX)} />
              </ListItem>
            ))}
          </AnimatePresence>
        </div>
      )}
    </Page>
  )
}
