import { Columns2, Eye, PencilLine, type LucideIcon } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useUI } from '@/app/AppProvider'
import { IconButton } from '@/components/ui'
import type { TKey } from '@/i18n'
import { cn } from '@/lib/cn'
import { storage } from '@/lib/format'
import { MarkdownView } from '@/features/markdown/MarkdownView'

/**
 * How diary entries open:
 *   hybrid — rendered; a click edits with the live render beside the text (stacked when narrow)
 *   view   — rendered only, nothing can be changed
 *   edit   — the Markdown source only, always editable, no render
 * One choice for the whole diary (remembered); a card can switch for itself.
 */
export type DiaryMode = 'hybrid' | 'view' | 'edit'

export const DIARY_MODES: { value: DiaryMode; icon: LucideIcon; key: TKey }[] = [
  { value: 'hybrid', icon: Columns2, key: 'diary.mode.hybrid' },
  { value: 'view', icon: Eye, key: 'diary.mode.view' },
  { value: 'edit', icon: PencilLine, key: 'diary.mode.edit' },
]

const KEY = 'diary.mode'

export function useDiaryMode(): [DiaryMode, (m: DiaryMode) => void] {
  const [mode, setMode] = useState<DiaryMode>(() => {
    const saved = storage.get<string>(KEY, 'hybrid')
    return DIARY_MODES.some((m) => m.value === saved) ? (saved as DiaryMode) : 'hybrid'
  })
  const set = useCallback((m: DiaryMode) => {
    storage.set(KEY, m)
    setMode(m)
  }, [])
  return [mode, set]
}

/** Three small buttons: the card's quick switch. */
export function ModeSwitch({ value, onChange, className }: { value: DiaryMode; onChange: (m: DiaryMode) => void; className?: string }) {
  const { t } = useUI()
  return (
    <div role="radiogroup" aria-label={t('diary.mode')} className={cn('flex items-center gap-0.5', className)}>
      {DIARY_MODES.map((m) => (
        <IconButton key={m.value} icon={m.icon} size="sm" label={t(m.key)} active={value === m.value} aria-checked={value === m.value} role="radio" onClick={() => onChange(m.value)} />
      ))}
    </div>
  )
}

/** Rows for a textarea that grows with its text, between min and max. */
export const rowsFor = (text: string, min: number, max: number) => Math.min(max, Math.max(min, text.split('\n').length + 1))

/**
 * The Markdown source with its render: side by side when there is room (container ≥ 40rem), one above the other when
 * not. The render follows every keystroke; both scroll inside the same height.
 */
export function SplitEditor({
  value,
  onChange,
  onKeyDown,
  placeholder,
  autoFocus,
  minRows = 4,
  textareaRef,
}: {
  value: string
  onChange: (v: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  autoFocus?: boolean
  minRows?: number
  textareaRef?: React.Ref<HTMLTextAreaElement>
}) {
  const { t } = useUI()
  return (
    <div className="@container">
      <div className="grid @2xl:grid-cols-2">
        <textarea
          ref={textareaRef}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={rowsFor(value, minRows, 24)}
          className="read-14 max-h-[60vh] w-full resize-none overflow-y-auto bg-transparent px-5 py-4 font-mono leading-relaxed text-fg placeholder:text-dim focus:outline-none"
        />
        <div className="max-h-[60vh] min-h-full overflow-y-auto border-t border-line px-5 py-4 @2xl:border-t-0 @2xl:border-l">
          {value.trim() ? <MarkdownView content={value} compact /> : <p className="read-14 text-dim">{t('diary.previewEmpty')}</p>}
        </div>
      </div>
    </div>
  )
}
