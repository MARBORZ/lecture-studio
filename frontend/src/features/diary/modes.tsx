import { Columns2, Eye, PencilLine, type LucideIcon } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useUI } from '@/app/AppProvider'
import { IconButton } from '@/components/ui'
import type { TKey } from '@/i18n'
import { cn } from '@/lib/cn'
import { storage } from '@/lib/format'

/**
 * How diary entries open:
 *   hybrid — one sheet in two states: rendered, and the block you click turns into its source in place (blocks.tsx)
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
