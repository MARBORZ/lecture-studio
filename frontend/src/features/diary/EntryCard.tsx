import { Check, ChevronDown, FolderInput, Trash2 } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import { api } from '@/api/client'
import type { DiaryCategory, DiaryEntry } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { AnimatePresence, m } from '@/components/motion'
import { IconButton, MenuItem, Popover } from '@/components/ui'
import { MarkdownView } from '@/features/markdown/MarkdownView'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/format'
import { collapse } from '@/lib/motion'
import { BlockEditor } from './blocks'
import { ModeSwitch, rowsFor, type DiaryMode } from './modes'

const AUTOSAVE_MS = 700
const LONG_CHARS = 900 // longer entries open as a preview with "show all"

/** The inbox category (listed first) is a folder named in Russian on disk: shown in the interface language. */
export function useCategoryLabel(categories: DiaryCategory[]) {
  const { t } = useUI()
  const inbox = categories[0]?.name
  return (name: string) => (name === inbox ? t('diary.inbox') : name)
}

/**
 * One diary entry in the diary's mode (modes.tsx), which the card can switch for itself:
 * hybrid — rendered, a click opens the source with its live render; view — rendered only; edit — the source only.
 * Edits save themselves a moment after typing stops, and when the editor closes.
 */
export const EntryCard = memo(function EntryCard({
  entry,
  categories,
  showCategory,
  mode: diaryMode,
  onChanged,
  onRemoved,
  folded,
  onFold,
}: {
  entry: DiaryEntry
  categories: DiaryCategory[]
  showCategory: boolean
  mode: DiaryMode
  onChanged: (entry: DiaryEntry, oldId: string) => void
  onRemoved: (id: string) => void
  folded: boolean
  onFold: (folded: boolean) => void
}) {
  const { t, lang, toast, confirm } = useUI()
  const label = useCategoryLabel(categories)
  // the card's own mode follows the diary's until the card is switched by hand
  const [own, setOwn] = useState<{ base: DiaryMode; mode: DiaryMode } | null>(null)
  const mode = own && own.base === diaryMode ? own.mode : diaryMode
  const [open, setOpen] = useState(false) // hybrid: a block is open as its source
  const editing = mode === 'edit' || (mode === 'hybrid' && open)
  const [draft, setDraft] = useState(entry.text)
  // a newer saved text (this card's save, or a move) becomes the draft unless the user is typing
  const [seen, setSeen] = useState(entry.text)
  if (entry.text !== seen) {
    setSeen(entry.text)
    if (!editing) setDraft(entry.text)
  }
  const [saving, setSaving] = useState(false)
  const [full, setFull] = useState(false)
  const long = entry.text.length > LONG_CHARS
  const lastSaved = useRef(entry.text)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const cardRef = useRef<HTMLElement>(null)

  const save = async (text: string) => {
    if (text.trim() === lastSaved.current.trim() || !text.trim()) return
    setSaving(true)
    try {
      const updated = await api.updateDiaryEntry(entry.id, { text })
      lastSaved.current = updated.text
      onChanged(updated, entry.id)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!editing) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(draft), AUTOSAVE_MS)
    return () => clearTimeout(timer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, editing])

  const finish = () => {
    clearTimeout(timer.current)
    void save(draft)
    setOpen(false)
  }
  const switchMode = (next: DiaryMode) => {
    if (editing) finish()
    setDraft(lastSaved.current)
    setOwn({ base: diaryMode, mode: next })
  }
  const body = folded ? null : mode === 'edit' ? (
    <textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void save(draft)}
      rows={rowsFor(draft, 3, 24)}
      aria-label={t('diary.mode.edit')}
      className="read-14 max-h-[60vh] w-full resize-none overflow-y-auto bg-transparent px-5 pt-1 pb-4 font-mono leading-relaxed text-fg focus:outline-none"
    />
  ) : (
    <div className={cn('relative px-5 pt-1 pb-4', long && !full && !editing && 'max-h-80 overflow-hidden')}>
      {mode === 'hybrid' ? (
        <BlockEditor value={draft} onChange={setDraft} onEditing={(on) => (on ? setOpen(true) : finish())} />
      ) : (
        <MarkdownView content={entry.text} compact className="read-15" />
      )}
      {long && !full && !editing && <span className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-surface to-transparent" />}
    </div>
  )

  return (
    <article
      ref={cardRef}
      className={cn('group rounded-2xl border bg-surface transition-colors', editing ? 'border-line-strong' : 'border-line hover:border-line-strong')}
    >
      {/* px-3 + the button's px-2 = the body's px-5: the date starts where the text does; py-2 on both sides when folded */}
      <header className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => {
            if (open && !folded) finish()
            onFold(!folded)
          }}
          aria-expanded={!folded}
          aria-label={folded ? t('diary.unfold') : t('diary.fold')}
          title={folded ? t('diary.unfold') : t('diary.fold')}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-hover focus:outline-none focus-visible:bg-hover"
        >
          <Icon as={ChevronDown} size={14} className={cn('shrink-0 text-dim transition-transform duration-200', folded && '-rotate-90')} />
          <span className="truncate text-[12.5px] text-muted">{formatDateTime(entry.created_at, lang)}</span>
          {showCategory && <span className="shrink-0 rounded-md border border-line px-1.5 py-px text-[11.5px] text-soft">{label(entry.category)}</span>}
          {folded && <span className="read-14 min-w-0 truncate text-soft">{entry.title || '…'}</span>}
        </button>
        {editing && <span className="shrink-0 text-[11.5px] text-dim">{saving ? t('diary.saving') : mode === 'edit' ? t('diary.autosave') : t('diary.editHint')}</span>}
        {/* visible at rest but quiet; stays visible while the menu is open (the pointer may leave the card for it) */}
        <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100">
          <ModeSwitch value={mode} onChange={switchMode} />
          <span className="mx-1 h-4 w-px bg-line" />
          {/* upwards: the next card would cover a menu opening down; a long list scrolls inside */}
          <Popover
            side="top"
            align="end"
            className="max-h-72 overflow-y-auto"
            trigger={({ open: menu, toggle }) => <IconButton icon={FolderInput} size="sm" label={t('diary.move')} active={menu} aria-expanded={menu} onClick={toggle} />}
          >
            {(close) =>
              categories.map((c) => {
                const here = c.name === entry.category
                return (
                  <MenuItem
                    key={c.name}
                    active={here}
                    disabled={here}
                    onClick={async () => {
                      close()
                      try {
                        onChanged(await api.updateDiaryEntry(entry.id, { category: c.name }), entry.id)
                      } catch (e) {
                        toast((e as Error).message, 'error')
                      }
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{label(c.name)}</span>
                    <Icon as={Check} size={14} className={cn(!here && 'invisible')} />
                  </MenuItem>
                )
              })
            }
          </Popover>
          <IconButton
            icon={Trash2}
            size="sm"
            label={t('diary.deleteEntry')}
            onClick={async () => {
              if (await confirm({ title: t('diary.deleteEntry'), text: t('diary.deleteEntryText'), danger: true, confirmLabel: t('common.delete') })) {
                await api.deleteDiaryEntry(entry.id).then(() => onRemoved(entry.id), (e) => toast(e.message, 'error'))
              }
            }}
          />
        </div>
      </header>
      <AnimatePresence initial={false}>
        {body && (
          <m.div key="body" variants={collapse} initial="hidden" animate="show" exit="exit" className="overflow-hidden">
            {body}
            {long && !editing && (
              <div className="px-5 pb-3">
                <button type="button" onClick={() => setFull(!full)} className="text-[12px] font-medium text-muted hover:text-fg">
                  {full ? t('diary.showLess') : t('diary.showAll')}
                </button>
              </div>
            )}
          </m.div>
        )}
      </AnimatePresence>
    </article>
  )
})
