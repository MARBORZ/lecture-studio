import { Clapperboard, Inbox, MessagesSquare, Pencil, Search, Trash2 } from 'lucide-react'
import { useDeferredValue, useMemo, useRef } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import type { LessonStatus } from '@/api/types'
import { useLibrary, useUI } from '@/app/AppProvider'
import { AnimatePresence, ListItem } from '@/components/motion'
import { Button, EmptyState, IconButton, Page, PageHeader, Pagination, SearchInput, Segmented } from '@/components/ui'
import { NotebookCover } from '@/features/library/NotebookCover'
import { SkeletonList } from '@/components/skeleton'
import { LessonRow } from '@/features/library/LessonRow'
import { ProjectFormModal } from '@/features/library/modals'
import { KeyNotice } from '@/features/system/KeyNotice'

type Filter = 'all' | LessonStatus
const INBOX = 'proj_inbox'
const FILTERS = ['all', 'in_progress', 'to_review', 'completed'] as const
const PAGE_SIZE = 30

export function LibraryPage() {
  const { projectId } = useParams()
  const { t, openModal, confirm, toast } = useUI()
  const { projects, lessons, loading, deleteProject, projectName } = useLibrary()
  const navigate = useNavigate()
  // status, search and page live in the URL (?status=&q=&page=): back from a lesson, the list is where it was.
  // Lessons are all in memory (the sidebar and moves need them), so the pages are cut here, not on the server.
  const [params, setParams] = useSearchParams()
  const filter: Filter = (FILTERS as readonly string[]).includes(params.get('status') ?? '') ? (params.get('status') as Filter) : 'all'
  const query = params.get('q') ?? ''
  const q = useDeferredValue(query.trim().toLowerCase())
  const listRef = useRef<HTMLDivElement>(null)
  // a new status or search starts at the first page; the page itself is set by Pagination
  const setParam = (key: 'status' | 'q' | 'page', value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (!value || (key === 'status' && value === 'all') || (key === 'page' && value === '1')) next.delete(key)
        else next.set(key, value)
        if (key !== 'page') next.delete('page')
        return next
      },
      { replace: true },
    )

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
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const page = Math.min(pages, Math.max(1, Number(params.get('page')) || 1)) // a page that no longer exists shows the last one
  const shown = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const toPage = (p: number) => {
    setParam('page', String(p))
    listRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  return (
    <Page>
      <PageHeader
        eyebrow={project ? t('common.notebook') : undefined}
        cover={project && <NotebookCover project={project} className="size-14 text-[22px]" />}
        title={project?.name ?? t('library.title')}
        subtitle={project?.description}
        actions={
          project && (
            <>
              <Link to={`/notebooks/${project.id}/chat`}>
                <Button icon={MessagesSquare} variant="primary" disabled={!inScope}>{t('library.chat')}</Button>
              </Link>
              <IconButton icon={Pencil} label={t('library.edit')} onClick={() => openModal((close) => <ProjectFormModal project={project} close={close} />)} />
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
        <SearchInput value={query} onChange={(e) => setParam('q', e.target.value)} placeholder={t('library.searchPlaceholder')} className="min-w-56 flex-1" />
        <Segmented
          value={filter}
          onChange={(v) => setParam('status', v)}
          options={FILTERS.map((s) => ({ value: s, label: t(`status.${s}`) }))}
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
        <div ref={listRef} className="flex scroll-mt-4 flex-col gap-4">
          {/* keyed by page: a new page enters fresh instead of 30 rows leaving next to 30 arriving */}
          <div key={page} className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            <AnimatePresence initial={true}>
              {shown.map((l, i) => (
                <ListItem key={l.id} index={i}>
                  <LessonRow lesson={l} notebook={projectId ? undefined : projectName(l.project_id ?? INBOX)} />
                </ListItem>
              ))}
            </AnimatePresence>
          </div>
          <Pagination page={page} size={PAGE_SIZE} total={visible.length} onPage={toPage} />
        </div>
      )}
    </Page>
  )
}
