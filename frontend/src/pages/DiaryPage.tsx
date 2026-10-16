import { ChevronsDownUp, ChevronsUpDown, FolderInput, NotebookPen, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router'
import { api } from '@/api/client'
import type { DiaryEntry } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { AnimatePresence, ListItem } from '@/components/motion'
import { Button, EmptyState, IconButton, Input, PageHeader, Segmented } from '@/components/ui'
import { Skeleton, SkeletonChat } from '@/components/skeleton'
import { EntryCard, useCategoryLabel } from '@/features/diary/EntryCard'
import { DIARY_MODES, rowsFor, SplitEditor, useDiaryMode } from '@/features/diary/modes'
import { cn } from '@/lib/cn'
import { storage } from '@/lib/format'
import { shortcutLabel } from '@/lib/keys'
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
  const [mode, setMode] = useDiaryMode()
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
        <div className="mx-auto max-w-4xl px-6 py-8 lg:px-10">
          <PageHeader eyebrow={t('diary.title')} title={category ? label(category) : t('diary.all')} subtitle={t('diary.subtitle')} />

          <Composer
            draft={draft}
            setDraft={setDraft}
            preview={mode === 'hybrid'}
            target={target ? label(target) : ''}
            adding={adding}
            onAdd={add}
          />

          <div className="sticky top-0 z-10 -mx-2 mt-8 mb-4 flex flex-wrap items-center gap-2 bg-bg/90 px-2 py-2 backdrop-blur">
            <div className="relative min-w-48 flex-1">
              <Icon as={Search} size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-dim" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('diary.search')} className="pl-8" />
            </div>
            <Segmented size="md" value={mode} onChange={setMode} options={DIARY_MODES.map((m) => ({ value: m.value, label: t(m.key) }))} />
            {Boolean(entries.data?.length) && (
              <>
                <IconButton icon={ChevronsDownUp} label={t('diary.foldAll')} onClick={() => fold(entries.data!.map((e) => e.id), true)} />
                <IconButton icon={ChevronsUpDown} label={t('diary.unfoldAll')} onClick={() => fold(entries.data!.map((e) => e.id), false)} />
              </>
            )}
          </div>
          <p className="-mt-2 mb-4 text-[12px] text-dim">{t(`diary.mode.${mode}.hint`)}</p>

          {entries.loading && !entries.data ? (
            <div className="flex flex-col gap-3"><SkeletonChat /><SkeletonChat /></div>
          ) : !entries.data?.length ? (
            <EmptyState icon={NotebookPen} title={t('diary.empty')} hint={q ? undefined : t('diary.emptyHint')} />
          ) : (
            <div className="flex flex-col gap-4">
              <AnimatePresence initial={true}>
                {entries.data.map((e, i) => (
                  <ListItem key={e.id} index={i}>
                    <EntryCard
                      entry={e}
                      categories={categories}
                      showCategory={!category}
                      mode={mode}
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

/** New entry: the source, with its live render beside it in the hybrid mode; ⌘/Ctrl+Enter saves into the category. */
function Composer({ draft, setDraft, preview, target, adding, onAdd }: { draft: string; setDraft: (v: string) => void; preview: boolean; target: string; adding: boolean; onAdd: () => void }) {
  const { t } = useUI()
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      onAdd()
    }
  }
  return (
    <div className="rounded-2xl border border-line bg-surface transition-colors focus-within:border-line-strong">
      {preview && draft.trim() ? (
        <SplitEditor value={draft} onChange={setDraft} onKeyDown={onKeyDown} placeholder={t('diary.composer')} minRows={3} autoFocus />
      ) : (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={rowsFor(draft, 3, 12)}
          placeholder={t('diary.composer')}
          className="read-15 max-h-[40vh] w-full resize-none overflow-y-auto bg-transparent px-5 py-4 leading-relaxed text-fg placeholder:text-dim focus:outline-none"
        />
      )}
      <div className="flex items-center gap-3 border-t border-line px-3 py-2">
        <span className="flex min-w-0 items-center gap-1.5 pl-2 text-[12.5px] text-muted">
          <Icon as={FolderInput} size={13} className="shrink-0" />
          <span className="truncate">{target}</span>
        </span>
        <span className="ml-auto hidden font-mono text-[11.5px] text-dim sm:inline">{shortcutLabel('Enter')}</span>
        <Button size="sm" variant="primary" icon={NotebookPen} disabled={!draft.trim() || !target} loading={adding} onClick={onAdd}>
          {t('diary.add')}
        </Button>
      </div>
    </div>
  )
}
