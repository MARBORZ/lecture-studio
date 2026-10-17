import { ChevronRight, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/api/client'
import type { PromptView } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { AnimatePresence, m } from '@/components/motion'
import { Button, Card, Textarea } from '@/components/ui'
import { SkeletonCard } from '@/components/skeleton'
import { cn } from '@/lib/cn'
import { collapse } from '@/lib/motion'
import type { TKey } from '@/i18n'
import { useResource } from '@/lib/useResource'

/** Settings → Instructions: the editable prompt blocks (the contract stays fixed in backend prompts.py). */
function PromptEditor({ block, onChange }: { block: PromptView; onChange: (all: PromptView[]) => void }) {
  const { t, toast, confirm } = useUI()
  /** Block titles are keyed in i18n; a block added on the backend later still shows its key. */
  const tr = (key: string, fallback: string) => {
    const v = t(key as TKey)
    return v === key ? fallback : v
  }
  const title = tr(`prompt.${block.key}.title`, block.key)
  const hint = tr(`prompt.${block.key}.hint`, '')
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(block.value)
  const [saved, setSaved] = useState(block.value)
  if (saved !== block.value) {
    setSaved(block.value) // server state changed (save/reset): follow it
    setValue(block.value)
  }
  const dirty = value.trim() !== block.value.trim()
  const run = (p: Promise<PromptView[]>) => p.then(onChange).catch((e) => toast(e.message, 'error'))

  return (
    <div className="border-t border-line first:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 py-3 text-left"
      >
        <Icon as={ChevronRight} size={14} className={cn('shrink-0 text-dim transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-fg">{title}</span>
          {hint && <span className="block truncate text-[12px] text-muted">{hint}</span>}
        </span>
        {dirty && <span className="size-1.5 shrink-0 rounded-full bg-fg" aria-label={t('common.unsaved')} />}
        <span className={cn('shrink-0 rounded-md border px-1.5 py-0.5 text-[11px]', block.modified ? 'border-fg text-fg' : 'border-line text-dim')}>
          {block.modified ? t('prompts.modified') : t('prompts.default')}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <m.div key="body" variants={collapse} initial="hidden" animate="show" exit="exit" className="overflow-hidden">
            <div className="flex flex-col gap-2 pb-4 pl-[26px]">
              <Textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                rows={Math.min(18, Math.max(3, value.split('\n').length + 1))}
                className="font-mono text-[12.5px] leading-relaxed"
              />
              <div className="flex justify-end gap-2">
                {block.modified && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={RotateCcw}
                    onClick={async () => {
                      if (await confirm({ title: `${t('prompts.reset')}: ${title}`, text: t('prompts.resetText') })) void run(api.resetPrompt(block.key))
                    }}
                  >
                    {t('prompts.reset')}
                  </Button>
                )}
                <Button size="sm" variant="primary" disabled={!dirty || !value.trim()} onClick={() => run(api.savePrompt(block.key, value)).then(() => toast(t('common.saved')))}>
                  {t('common.save')}
                </Button>
              </div>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function PromptsSettings() {
  const { t } = useUI()
  const blocks = useResource(() => api.prompts(), [])
  if (!blocks.data) return <SkeletonCard />
  return (
    <div className="flex flex-col gap-6">
      <p className="text-[13px] leading-relaxed text-muted">{t('prompts.hint')}</p>
      {(['audit', 'assistant'] as const).map((group) => (
        <Card key={group} title={t(`prompts.group.${group}`)} description={group === 'audit' ? t('prompts.applyHint') : undefined}>
          <div className="flex flex-col">
            {blocks.data!.filter((b) => b.group === group).map((b) => (
              <PromptEditor key={b.key} block={b} onChange={(all) => blocks.setData(all)} />
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}
