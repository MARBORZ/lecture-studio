import { Check, ChevronRight, FolderInput, Trash2 } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import { api } from '@/api/client'
import type { DiaryCategory, DiaryEntry } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { IconButton, MenuItem, Popover } from '@/components/ui'
import { MarkdownView } from '@/features/markdown/MarkdownView'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/format'

const AUTOSAVE_MS = 700
const LONG_CHARS = 700 // longer entries open as a preview with "show all"

/** The inbox category (listed first) is a folder named in Russian on disk: shown in the interface language. */
export function useCategoryLabel(categories: DiaryCategory[]) {
  const { t } = useUI()
  const inbox = categories[0]?.name
  return (name: string) => (name === inbox ? t('diary.inbox') : name)
}

/** One diary entry: rendered Markdown; click to edit in place with autosave. */
export const EntryCard = memo(function EntryCard({
  entry,
  categories,
  showCategory,
  onChanged,
  onRemoved,
  folded,
  onFold,
}: {
  entry: DiaryEntry
  categories: DiaryCategory[]
  showCategory: boolean
  onChanged: (entry: DiaryEntry, oldId: string) => void
  onRemoved: (id: string) => void
  folded: boolean
  onFold: (folded: boolean) => void
}) {
  const { t, lang, toast, confirm } = useUI()
  const label = useCategoryLabel(categories)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entry.text)
  const [saving, setSaving] = useState(false)
  const [full, setFull] = useState(false)
  const long = entry.text.length > LONG_CHARS
  const lastSaved = useRef(entry.text)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

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
    setEditing(false)
  }

  return (
    <article className={cn('group rounded-xl border bg-surface transition-colors', editing ? 'border-line-strong' : 'border-line hover:border-line-strong')}>
      {folded && !editing ? (
        <button type="button" onClick={() => onFold(false)} className="flex w-full items-center gap-2 px-5 py-3 text-left">
          <Icon as={ChevronRight} size={14} className="shrink-0 text-dim" />
          <span className="read-14 min-w-0 flex-1 truncate text-soft">{entry.title || '…'}</span>
        </button>
      ) : editing ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={finish}
          onKeyDown={(e) => e.key === 'Escape' && finish()}
          rows={Math.min(24, Math.max(4, draft.split('\n').length + 1))}
          // bounded: a long entry scrolls inside the field instead of pushing the page ever deeper
          className="max-h-[60vh] w-full resize-none overflow-y-auto rounded-xl bg-transparent px-5 py-4 font-mono read-13 leading-relaxed text-fg focus:outline-none"
        />
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            setDraft(lastSaved.current)
            setEditing(true)
          }}
          onKeyDown={(e) => e.key === 'Enter' && setEditing(true)}
          className={cn('relative cursor-text px-5 py-4', long && !full && 'max-h-72 overflow-hidden')}
        >
          <MarkdownView content={entry.text} compact />
          {long && !full && <span className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-surface to-transparent" />}
        </div>
      )}
      <footer className="flex items-center gap-3 border-t border-line px-5 py-2 text-[11.5px] text-dim">
        {!editing && (
          <button type="button" onClick={() => onFold(!folded)} aria-label={folded ? t('diary.unfold') : t('diary.fold')} title={folded ? t('diary.unfold') : t('diary.fold')} className="-ml-1 rounded p-0.5 hover:text-fg">
            <Icon as={ChevronRight} size={13} className={cn('transition-transform duration-200', !folded && 'rotate-90')} />
          </button>
        )}
        <span className="font-mono">{formatDateTime(entry.created_at, lang)}</span>
        {long && !folded && !editing && (
          <button type="button" onClick={() => setFull(!full)} className="hover:text-fg">{full ? t('diary.showLess') : t('diary.showAll')}</button>
        )}
        {showCategory && <span className="truncate">· {label(entry.category)}</span>}
        {editing && <span className="truncate">{saving ? t('diary.saving') : t('diary.editHint')}</span>}
        <div className="flex-1" />
        {/* stays visible while the menu is open: the pointer may leave the card for the menu */}
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100">
          {/* upwards: the next card would cover a menu opening down; a long list scrolls inside */}
          <Popover
            side="top"
            align="end"
            className="max-h-72 overflow-y-auto"
            trigger={({ open, toggle }) => <IconButton icon={FolderInput} size="sm" label={t('diary.move')} active={open} aria-expanded={open} onClick={toggle} />}
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
      </footer>
    </article>
  )
})
