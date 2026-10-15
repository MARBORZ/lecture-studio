import { Check, ChevronDown, Eraser, Gauge, MessagesSquare, Pencil, Plus, Trash2 } from 'lucide-react'
import type { ContextUsage } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Button, IconButton, MenuItem, Popover } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatCount, formatDateTime } from '@/lib/format'
import type { ThreadApi } from './useThread'

/** Session switcher (branches of the chat, like Claude Code sessions) + new session + clear. */
export function SessionBar({ chat }: { chat: ThreadApi }) {
  const { t, lang, confirm, promptText, toast } = useUI()
  const { thread, session } = chat
  const sessions = thread?.sessions ?? []
  const hasMessages = Boolean(session?.messages?.length)
  const title = session?.title || t('assistant.session.untitled')
  const run = (p: Promise<unknown>) => p.catch((e: Error) => toast(e.message, 'error'))

  return (
    <div className="flex min-w-0 items-center gap-1">
      <Popover
        rootClassName="min-w-0"
        trigger={({ toggle, open }) => (
          <button
            type="button"
            onClick={toggle}
            className={cn('flex h-7 w-full max-w-64 items-center gap-1.5 rounded-lg px-2 text-[13px] transition-colors hover:bg-hover', open ? 'bg-hover text-fg' : 'text-soft')}
          >
            <Icon as={MessagesSquare} size={14} className="shrink-0" />
            <span className="truncate">{title}</span>
            <Icon as={ChevronDown} size={13} className="shrink-0 text-dim" />
          </button>
        )}
        className="w-80"
      >
        {(close) => (
          <div className="flex flex-col">
            <div className="label-caps px-2.5 pt-1.5 pb-2">{t('assistant.session.list')}</div>
            <div className="flex max-h-72 flex-col overflow-y-auto">
              {sessions.length === 0 && <p className="px-2.5 py-2 text-[12.5px] text-muted">{t('assistant.session.none')}</p>}
              {sessions.map((s) => (
                <div key={s.id} className="group flex items-center gap-1">
                  <MenuItem active={s.id === session?.id} onClick={() => (close(), run(chat.select(s.id)))} className="min-w-0 flex-1">
                    <Icon as={Check} size={13} className={cn('shrink-0', s.id === session?.id ? 'opacity-100' : 'opacity-0')} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{s.title || t('assistant.session.untitled')}</span>
                      <span className="block font-mono text-[11px] text-dim">
                        {t('assistant.session.count', { n: s.messages })} · {formatDateTime(s.updated_at ?? '', lang)}
                      </span>
                    </span>
                  </MenuItem>
                  <IconButton
                    icon={Pencil}
                    size="sm"
                    label={t('assistant.session.rename')}
                    className="opacity-0 group-hover:opacity-100"
                    onClick={async () => {
                      const v = await promptText({ title: t('assistant.session.rename'), initial: s.title, maxLength: 80 })
                      if (v) await run(chat.rename(s.id, v))
                    }}
                  />
                  <IconButton
                    icon={Trash2}
                    size="sm"
                    label={t('assistant.session.delete')}
                    className="opacity-0 group-hover:opacity-100"
                    onClick={async () => {
                      if (await confirm({ title: t('assistant.session.delete'), text: t('assistant.session.deleteText'), danger: true, confirmLabel: t('common.delete') }))
                        await run(chat.remove(s.id))
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-1 border-t border-line pt-1">
              <MenuItem onClick={() => (close(), run(chat.create()))}>
                <Icon as={Plus} size={14} />
                {t('assistant.session.new')}
              </MenuItem>
            </div>
          </div>
        )}
      </Popover>
      <IconButton icon={Plus} size="sm" label={t('assistant.session.new')} disabled={!hasMessages} onClick={() => run(chat.create())} />
      <IconButton
        icon={Eraser}
        size="sm"
        label={t('assistant.clear')}
        disabled={!hasMessages}
        onClick={async () => {
          if (await confirm({ title: t('assistant.clear'), text: t('assistant.clearText'), danger: true, confirmLabel: t('assistant.clearConfirm') })) await run(chat.clear())
        }}
      />
    </div>
  )
}

const PARTS = [
  { key: 'sources', cls: 'bg-fg' },
  { key: 'files', cls: 'bg-soft' },
  { key: 'history', cls: 'bg-muted' },
  { key: 'summary', cls: 'bg-dim' },
  { key: 'system', cls: 'bg-line-strong' },
] as const

/**
 * Our own context window, visible: the API keeps no memory, every question re-sends sources, history and files.
 * The bar shows how much of the provider's window the next question takes and what it is made of.
 */
export function ContextMeter({ chat }: { chat: ThreadApi }) {
  const { t, lang, toast } = useUI()
  const usage: ContextUsage | null | undefined = chat.thread?.context
  if (!usage) return null
  const pct = Math.min(100, Math.round((usage.total / usage.window) * 100))
  const n = (v: number) => formatCount(v, lang)
  const recent = (chat.session?.messages?.length ?? 0) - (chat.session?.summarized ?? 0)

  return (
    <Popover
      align="end"
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          title={t('assistant.context.title')}
          className={cn('flex h-7 items-center gap-2 rounded-lg px-2 text-[12px] transition-colors hover:bg-hover', open ? 'bg-hover text-fg' : 'text-muted')}
        >
          <Icon as={Gauge} size={14} />
          <span className="relative h-1.5 w-14 overflow-hidden rounded-full bg-line">
            <span className="absolute inset-y-0 left-0 rounded-full bg-fg" style={{ width: `${Math.max(2, pct)}%` }} />
          </span>
          <span className="font-mono tabular-nums">{pct}%</span>
        </button>
      )}
      className="w-80 p-3"
    >
      {(close) => (
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-[13px] font-medium text-fg">{t('assistant.context.title')}</div>
            <div className="font-mono text-[11.5px] text-muted">{t('assistant.context.of', { used: n(usage.total), window: n(usage.window), provider: usage.provider })}</div>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-line">
            {PARTS.map((p) => (
              <span key={p.key} className={p.cls} style={{ width: `${(usage[p.key] / usage.window) * 100}%` }} />
            ))}
          </div>
          <ul className="flex flex-col gap-1.5 text-[12.5px]">
            {PARTS.map((p) => (
              <li key={p.key} className="flex items-center gap-2 text-soft">
                <span className={cn('size-2 shrink-0 rounded-full', p.cls)} />
                <span className="flex-1">{t(`assistant.context.${p.key}`)}</span>
                <span className="font-mono text-[11.5px] text-muted tabular-nums">{n(usage[p.key])}</span>
              </li>
            ))}
          </ul>
          {usage.summarized > 0 && <p className="text-[12px] text-muted">{t('assistant.context.summarized', { n: usage.summarized })}</p>}
          {usage.sources_trimmed && <p className="text-[12px] text-soft">{t('assistant.context.trimmed')}</p>}
          <p className="text-[12px] leading-relaxed text-dim">{t('assistant.context.hint')}</p>
          <Button
            size="sm"
            disabled={recent <= 2}
            onClick={async () => {
              close()
              try {
                await chat.compact()
                toast(t('assistant.context.compacted'))
              } catch (e) {
                toast((e as Error).message, 'error')
              }
            }}
          >
            {t('assistant.context.compact')}
          </Button>
        </div>
      )}
    </Popover>
  )
}
