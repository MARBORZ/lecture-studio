import { Trash2 } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import { api } from '@/api/client'
import type { DiaryCategory, DiaryEntry } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { IconButton, Select } from '@/components/ui'
import { MarkdownView } from '@/features/markdown/MarkdownView'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/format'

const AUTOSAVE_MS = 700

/** One diary entry: rendered Markdown; click to edit in place with autosave. */
export const EntryCard = memo(function EntryCard({
  entry,
  categories,
  showCategory,
  onChanged,
  onRemoved,
}: {
  entry: DiaryEntry
  categories: DiaryCategory[]
  showCategory: boolean
  onChanged: (entry: DiaryEntry, oldId: string) => void
  onRemoved: (id: string) => void
}) {
  const { t, lang, toast, confirm } = useUI()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entry.text)
  const [saving, setSaving] = useState(false)
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
      {editing ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={finish}
          onKeyDown={(e) => e.key === 'Escape' && finish()}
          rows={Math.max(4, draft.split('\n').length + 1)}
          className="w-full resize-none rounded-xl bg-transparent px-5 py-4 font-mono text-[13px] leading-relaxed text-fg focus:outline-none"
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
          className="cursor-text px-5 py-4"
        >
          <MarkdownView content={entry.text} compact />
        </div>
      )}
      <footer className="flex items-center gap-3 border-t border-line px-5 py-2 text-[11.5px] text-dim">
        <span className="font-mono">{formatDateTime(entry.created_at, lang)}</span>
        {showCategory && <span className="truncate">· {entry.category}</span>}
        {editing && <span className="truncate">{saving ? t('diary.saving') : t('diary.editHint')}</span>}
        <div className="flex-1" />
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Select
            aria-label={t('diary.move')}
            title={t('diary.move')}
            value={entry.category}
            onChange={async (category) => {
              try {
                onChanged(await api.updateDiaryEntry(entry.id, { category }), entry.id)
              } catch (e) {
                toast((e as Error).message, 'error')
              }
            }}
            options={categories.map((c) => ({ value: c.name, label: c.name }))}
            className="h-7 w-40 text-[12px]"
          />
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
