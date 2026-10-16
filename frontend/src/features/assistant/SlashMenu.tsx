import { BookOpen, Bug, Code2, Eraser, FileQuestion, History, ListTree, Minimize2, Plus, Sparkles, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AssistantRole } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { AnimatePresence, m } from '@/components/motion'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/format'
import { pop } from '@/lib/motion'
import type { ThreadApi } from './useThread'

type Quick = Exclude<AssistantRole, 'qa'>

/** One slash command: a name to type, what it does, and its action. */
interface Command {
  name: string
  icon: LucideIcon
  label: string
  hint: string
  run: () => void
  /** /resume opens a second level: the sessions */
  sessions?: boolean
}

/**
 * "/" at the start of the input opens the command list, like Claude Code: arrows move, Enter or Tab runs, Esc closes.
 * Chat commands (/resume, /new, /compact, /clear) and the quick actions (/key, /pitfalls…) live here, so the panel
 * itself carries no row of buttons.
 */
export function SlashMenu({
  query,
  open,
  chat,
  disabled,
  onQuick,
  onClose,
  onClearConfirmed,
  inputRef,
}: {
  query: string
  open: boolean
  chat: ThreadApi
  disabled: boolean
  onQuick: (role: Quick) => void
  onClose: () => void
  onClearConfirmed: () => void
  inputRef: React.RefObject<HTMLTextAreaElement | null>
}) {
  const { t, lang, toast } = useUI()
  const [index, setIndex] = useState(0)
  const [level, setLevel] = useState<'commands' | 'sessions'>('commands')
  const listRef = useRef<HTMLDivElement>(null)
  const run = (p: Promise<unknown>) => p.catch((e: Error) => toast(e.message, 'error'))
  const hasMessages = Boolean(chat.session?.messages?.length)

  const commands = useMemo<Command[]>(() => {
    const quick: [Quick, 'key' | 'pitfalls' | 'code' | 'quiz' | 'chapters', LucideIcon][] = [
      ['key_moments', 'key', Sparkles],
      ['pitfalls', 'pitfalls', Bug],
      ['code_summary', 'code', Code2],
      ['quiz', 'quiz', FileQuestion],
      ['chapters', 'chapters', ListTree],
    ]
    return [
      { name: 'resume', icon: History, label: t('assistant.cmd.resume'), hint: t('assistant.cmd.resumeHint'), run: () => setLevel('sessions'), sessions: true },
      { name: 'new', icon: Plus, label: t('assistant.session.new'), hint: t('assistant.cmd.newHint'), run: () => run(chat.create()) },
      { name: 'compact', icon: Minimize2, label: t('assistant.context.compact'), hint: t('assistant.cmd.compactHint'), run: () => run(chat.compact().then(() => toast(t('assistant.context.compacted')))) },
      { name: 'clear', icon: Eraser, label: t('assistant.clear'), hint: t('assistant.cmd.clearHint'), run: onClearConfirmed },
      ...quick.map(([role, name, icon]) => ({ name, icon, label: t(`assistant.role.${role}`), hint: t(`assistant.cmd.${name}Hint`), run: () => onQuick(role) })),
    ].filter((c) => (c.name === 'compact' || c.name === 'clear' ? hasMessages : true) && (disabled ? ['resume', 'new'].includes(c.name) : true))
  }, [t, chat, hasMessages, disabled, onQuick, onClearConfirmed]) // eslint-disable-line react-hooks/exhaustive-deps -- run/toast are stable enough

  const sessions = chat.thread?.sessions ?? []
  const q = query.trim().toLowerCase()
  const items = level === 'commands' ? commands.filter((c) => c.name.startsWith(q) || c.label.toLowerCase().includes(q)) : sessions
  const count = items.length

  // a new query or opening again starts at the top of the command list (adjusted during render, not in an effect)
  const [seen, setSeen] = useState(`${q}|${open}`)
  if (seen !== `${q}|${open}`) {
    setSeen(`${q}|${open}`)
    setIndex(0)
    if (!open) setLevel('commands')
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement !== inputRef.current) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setIndex((i) => (count ? (i + (e.key === 'ArrowDown' ? 1 : -1) + count) % count : 0))
      } else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        if (!count) return
        e.preventDefault()
        e.stopPropagation()
        pick(index)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (level === 'sessions') setLevel('commands')
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }) // the handler reads the current list and index

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  function pick(i: number) {
    if (level === 'commands') {
      const c = (items as Command[])[i]
      if (!c) return
      if (!c.sessions) onClose()
      c.run()
      if (c.sessions) setIndex(0)
    } else {
      const s = sessions[i]
      if (!s) return
      onClose()
      void run(chat.select(s.id))
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <m.div
          key="slash"
          variants={pop}
          initial="hidden"
          animate="show"
          exit="exit"
          className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-xl border border-line-strong bg-raised shadow-float"
        >
          <div className="label-caps px-3 pt-2.5 pb-1.5">{level === 'commands' ? t('assistant.cmd.title') : t('assistant.session.list')}</div>
          <div ref={listRef} className="scroll-hidden flex max-h-72 flex-col px-1.5 pb-1.5">
            {count === 0 && <p className="px-2.5 py-2 text-[12.5px] text-muted">{level === 'commands' ? t('assistant.cmd.none') : t('assistant.session.none')}</p>}
            {level === 'commands'
              ? (items as Command[]).map((c, i) => (
                  <button
                    key={c.name}
                    type="button"
                    data-i={i}
                    onMouseEnter={() => setIndex(i)}
                    onMouseDown={(e) => e.preventDefault()} // keep the focus in the input
                    onClick={() => pick(i)}
                    className={cn('flex items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none', i === index ? 'bg-hover text-fg' : 'text-soft')}
                  >
                    <Icon as={c.icon} size={15} className="shrink-0 text-muted" />
                    <span className="w-24 shrink-0 font-mono text-[12.5px]">/{c.name}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px]">
                      <span className="text-fg">{c.label}</span>
                      <span className="text-dim"> · {c.hint}</span>
                    </span>
                  </button>
                ))
              : sessions.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    data-i={i}
                    onMouseEnter={() => setIndex(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(i)}
                    className={cn('flex items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none', i === index ? 'bg-hover text-fg' : 'text-soft')}
                  >
                    <Icon as={BookOpen} size={15} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate text-[12.5px]">{s.title || t('assistant.session.untitled')}</span>
                    <span className="shrink-0 font-mono text-[11px] text-dim">
                      {t('assistant.session.count', { n: s.messages })} · {formatDateTime(s.updated_at ?? '', lang)}
                    </span>
                  </button>
                ))}
          </div>
        </m.div>
      )}
    </AnimatePresence>
  )
}
