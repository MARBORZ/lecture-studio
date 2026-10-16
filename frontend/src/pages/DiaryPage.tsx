import { NotebookPen, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router'
import { api } from '@/api/client'
import type { DiaryEntry } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { AnimatePresence, ListItem } from '@/components/motion'
import { Button, EmptyState, IconButton, PageHeader } from '@/components/ui'
import { Skeleton, SkeletonChat } from '@/components/skeleton'
import { EntryCard, useCategoryLabel } from '@/features/diary/EntryCard'
import { cn } from '@/lib/cn'
import { storage } from '@/lib/format'
import { useResource } from '@/lib/useResource'

/** Diary: Obsidian-style categories on the left, quick-capture stream on the right. */
export function DiaryPage() {
  const { category } = useParams()
  const navigate = useNavigate()
  const { t, toast, confirm, promptText } = useUI()
  const [query, setQuery] = useState('')
  const q = useDeferredValue(query.trim())
  const cats = useResource(() => api.diaryCategories(), [])
  const entries = useResource(() => api.diaryEntries(category, q || undefined), [category, q])
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  // folded entries (ids), remembered; "fold all" folds what is on screen
  const [folded, setFolded] = useState<string[]>(() => storage.get('diary.folded', []))
  const fold = (ids: string[], on: boolean) =>
    setFolded((prev) => {
      const next = on ? [...new Set([...prev, ...ids])] : prev.filter((x) => !ids.includes(x))
      storage.set('diary.folded', next.slice(-500))
      return next
    })

  const categories = cats.data ?? []
  const target = category ?? categories[0]?.name
  const inbox = categories[0]?.name
  const label = useCategoryLabel(categories)

  const fail = (e: unknown) => toast((e as Error).message, 'error')

  async function add() {
    if (!draft.trim() || adding) return
    setAdding(true)
    try {
      const created = await api.createDiaryEntry(draft, target)
      entries.setData((prev) => [created, ...(prev ?? [])])
      setDraft('')
      void cats.reload()
    } catch (e) {
      fail(e)
    } finally {
      setAdding(false)
    }
  }

  function changed(updated: DiaryEntry, oldId: string) {
    const leavesView = Boolean(category) && updated.category !== category
    entries.setData((prev) => (prev ?? []).flatMap((e) => (e.id !== oldId ? [e] : leavesView ? [] : [updated])))
    if (updated.id !== oldId) void cats.reload() // moved: counts changed
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-line">
        <div className="flex items-center justify-between px-5 pt-6 pb-2">
          <span className="label-caps">{t('diary.categories')}</span>
          <IconButton
            icon={Plus}
            size="sm"
            className="-mr-2"
            label={t('diary.newCategory')}
            onClick={async () => {
              const name = await promptText({ title: t('diary.newCategory'), label: t('common.name'), confirmLabel: t('common.create'), maxLength: 60 })
              if (name) await api.createDiaryCategory(name).then((c) => (void cats.reload(), navigate(`/diary/${encodeURIComponent(c.name)}`)), fail)
            }}
          />
        </div>
        <nav className="scroll-area flex flex-1 flex-col gap-0.5 px-3 pb-4">
          <CategoryLink to="/diary" end label={t('diary.all')} count={categories.reduce((n, c) => n + (c.count ?? 0), 0)} />
          {cats.loading && !cats.data
            ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="mx-3 my-2 h-3.5" />)
            : categories.map((c) => (
                <CategoryLink
                  key={c.name}
                  to={`/diary/${encodeURIComponent(c.name)}`}
                  label={label(c.name)}
                  count={c.count ?? 0}
                  actions={
                    c.name !== inbox && (
                      <>
                        <IconButton
                          icon={Pencil}
                          size="sm"
                          label={t('diary.renameCategory')}
                          onClick={async () => {
                            const to = await promptText({ title: t('diary.renameCategory'), label: t('common.name'), initial: c.name, maxLength: 60 })
                            if (to && to !== c.name)
                              await api.renameDiaryCategory(c.name, to).then((r) => (void cats.reload(), category === c.name && navigate(`/diary/${encodeURIComponent(r.name)}`)), fail)
                          }}
                        />
                        <IconButton
                          icon={Trash2}
                          size="sm"
                          label={t('diary.deleteCategory')}
                          onClick={async () => {
                            if (await confirm({ title: `${t('diary.deleteCategory')}: ${c.name}`, text: t('diary.deleteCategoryText'), danger: true, confirmLabel: t('common.delete') })) {
                              await api.deleteDiaryCategory(c.name).then(() => (void cats.reload(), void entries.reload(), category === c.name && navigate('/diary')), fail)
                            }
                          }}
                        />
                      </>
                    )
                  }
                />
              ))}
        </nav>
      </aside>

      <section className="scroll-area min-w-0 flex-1">
        <div className="mx-auto max-w-3xl px-6 py-8 lg:px-10">
          <PageHeader eyebrow={t('diary.title')} title={category ? label(category) : t('diary.all')} subtitle={t('diary.subtitle')} />

          <div className="rounded-xl border border-line bg-surface focus-within:border-line-strong">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  void add()
                }
              }}
              rows={Math.min(12, Math.max(3, draft.split('\n').length + 1))}
              // grows up to 12 lines, then scrolls inside
              placeholder={t('diary.composer')}
              className="read-14 max-h-[40vh] w-full resize-none overflow-y-auto bg-transparent px-5 py-4 leading-relaxed text-fg placeholder:text-dim focus:outline-none"
            />
            <div className="flex items-center justify-between border-t border-line px-3 py-2">
              <span className="pl-2 text-[12px] text-dim">→ {target}</span>
              <Button size="sm" variant="primary" icon={NotebookPen} disabled={!draft.trim() || !target} loading={adding} onClick={add}>
                {t('diary.add')}
              </Button>
            </div>
          </div>

          <div className="relative mt-6 mb-4">
            <Icon as={Search} size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-dim" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('common.search')}
              className="h-9 w-full rounded-lg border border-line bg-surface pr-3 pl-8 text-[13.5px] text-fg placeholder:text-dim focus:border-fg focus:outline-none"
            />
          </div>

          {Boolean(entries.data?.length) && (
            <div className="mb-2 flex justify-end gap-3 text-[12px]">
              <button type="button" className="text-muted hover:text-fg" onClick={() => fold(entries.data!.map((e) => e.id), true)}>{t('diary.foldAll')}</button>
              <button type="button" className="text-muted hover:text-fg" onClick={() => fold(entries.data!.map((e) => e.id), false)}>{t('diary.unfoldAll')}</button>
            </div>
          )}
          {entries.loading && !entries.data ? (
            <div className="flex flex-col gap-3"><SkeletonChat /><SkeletonChat /></div>
          ) : !entries.data?.length ? (
            <EmptyState icon={NotebookPen} title={t('diary.empty')} hint={q ? undefined : t('diary.emptyHint')} />
          ) : (
            <div className="flex flex-col gap-3">
              <AnimatePresence initial={true}>
                {entries.data.map((e, i) => (
                  <ListItem key={e.id} index={i}>
                    <EntryCard
                      entry={e}
                      categories={categories}
                      showCategory={!category}
                      onChanged={changed}
                      folded={folded.includes(e.id)}
                      onFold={(on) => fold([e.id], on)}
                      onRemoved={(id) => (entries.setData((prev) => (prev ?? []).filter((x) => x.id !== id)), void cats.reload())}
                    />
                  </ListItem>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function CategoryLink({ to, label, count, end, actions }: { to: string; label: string; count: number; end?: boolean; actions?: React.ReactNode }) {
  return (
    <div className="group relative">
      <NavLink
        to={to}
        end={end}
        className={({ isActive }) => cn('flex h-8 items-center gap-2 rounded-lg px-3 text-[13px] transition-colors', isActive ? 'bg-raised text-fg' : 'text-muted hover:bg-surface hover:text-soft')}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="font-mono text-[11px] text-dim group-hover:opacity-0">{count}</span>
      </NavLink>
      {actions && <div className="absolute top-0.5 right-1 hidden items-center group-hover:flex">{actions}</div>}
    </div>
  )
}
