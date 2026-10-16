import { ArrowUp, NotebookPen, TriangleAlert, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import type { AIProvider, AssistantRole, Attachment, ChatMessage, ContextUsage, ThreadKind } from '@/api/types'
import { useLibrary, useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Appear } from '@/components/motion'
import { Button, IconButton, Select } from '@/components/ui'
import { SkeletonChat } from '@/components/skeleton'
import { MarkdownView } from '@/features/markdown/MarkdownView'
import { KeyNotice, pickProvider, useAiKeys, useProviderOptions } from '@/features/system/KeyNotice'
import { cn } from '@/lib/cn'
import { formatTc } from '@/lib/time'
import { AttachButton, AttachmentChip, useAttachments } from './attachments'
import { ContextMeter, SessionBar } from './SessionBar'
import { SelectionAsk, withQuote } from './SelectionAsk'
import { SlashMenu } from './SlashMenu'
import { useThread } from './useThread'


/**
 * Router state a page passes to open the assistant with a quote: text selected in the audit, or a moment of the paused
 * player (`at`, seconds) — then `newSession` starts a separate session named by that time.
 */
export interface AskState { quote?: string; newSession?: boolean; at?: number }

/**
 * Grounded chat over lesson sources, in sessions.
 *   kind="lesson"  — one lesson, citations [MM:SS] seek the player
 *   kind="project" — selected lessons of a notebook, citations [[lesson@MM:SS]] open the lesson
 */
export function AssistantPanel({ kind, id, sources, lessonId }: { kind: ThreadKind; id: string; sources?: string[]; lessonId?: string }) {
  const { t, settings, toast, confirm } = useUI()
  const { patchLesson, lessons } = useLibrary()
  const keys = useAiKeys()
  const [provider, setProvider] = useState<AIProvider>(() => pickProvider(settings?.ai.assistant_provider ?? 'deepseek', keys))
  const providerOptions = useProviderOptions()
  const chat = useThread(kind, id, provider, sources)
  const files = useAttachments(chat.session?.id ?? '')
  const { clear: clearDrafts } = files
  useEffect(() => clearDrafts(), [chat.session?.id, clearDrafts]) // drafts belong to the session they were added in
  const location = useLocation()
  const navigate = useNavigate()
  const [question, setQuestion] = useState('')
  const [quote, setQuote] = useState('')
  // the question waiting for its answer: kept outside this page (pending.ts), so leaving and coming back keeps it
  const pending = chat.waiting
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const messages = chat.session?.messages ?? []
  const summarized = chat.session?.summarized ?? 0

  // a quote handed over by another page (or the player) is taken once, also while this tab is already open
  const handed = location.state as AskState | null
  useEffect(() => {
    if (!handed?.quote) return
    navigate('.', { replace: true, state: null })
    const take = () => {
      setQuote(handed.quote ?? '')
      inputRef.current?.focus()
    }
    if (!handed.newSession) return take()
    chat
      .create()
      .then((sid) => (handed.at === undefined ? undefined : chat.rename(sid, t('assistant.sessionFrom', { tc: formatTc(handed.at) }))))
      .then(take, (e) => toast((e as Error).message, 'error'))
  }, [handed]) // eslint-disable-line react-hooks/exhaustive-deps -- once per hand-over; chat changes every render

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, pending])

  function takeQuote(text: string) {
    setQuote(text)
    inputRef.current?.focus()
  }

  async function ask(role: AssistantRole, text: string) {
    if (pending || files.uploading) return
    const base = text || (quote ? t('assistant.quoteDefault') : '') || (files.ids.length ? t('assistant.attachOnly') : '')
    const full = quote && role === 'qa' ? withQuote(quote, base) : base
    setQuestion('')
    try {
      await chat.ask({ question: full, role, attachments: files.ids }, full || t(`assistant.role.${role as Exclude<AssistantRole, 'qa'>}`))
      files.clear()
      setQuote('')
    } catch (e) {
      toast((e as Error).message, 'error')
      setQuestion(text)
    }
  }

  async function saveToNotes(msg: ChatMessage) {
    if (!lessonId) return
    const current = lessons.find((l) => l.id === lessonId)?.notes ?? ''
    await patchLesson(lessonId, { notes: [current.trim(), msg.content.trim()].filter(Boolean).join('\n\n---\n\n') })
    toast(t('assistant.addedToNotes'))
  }

  const noSources = kind === 'project' && sources?.length === 0
  // "/" at the start (no space yet) opens the command list; the slash button types it
  const slashOpen = question.startsWith('/') && !question.includes(' ') && !pending
  async function clearChat() {
    setQuestion('')
    if (await confirm({ title: t('assistant.clear'), text: t('assistant.clearText'), danger: true, confirmLabel: t('assistant.clearConfirm') }))
      await chat.clear().catch((e: Error) => toast(e.message, 'error'))
  }
  const canSend = (Boolean(question.trim()) || Boolean(quote) || files.ids.length > 0) && !pending && !files.uploading

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        setDragging(false)
        files.add(e.dataTransfer.files)
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border border-dashed border-fg bg-bg/80 text-[13.5px] text-fg">
          {t('assistant.dropFiles')}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 pb-2">
        <div className="min-w-0 flex-1 basis-48">
          <SessionBar chat={chat} />
        </div>
        <ContextMeter chat={chat} />
        <Select size="sm" aria-label={t('ai.model')} className="w-40" value={provider} onChange={setProvider} options={providerOptions} />
      </div>

      <KeyNotice provider={provider} onSwitch={setProvider} className="mb-3" />

      <SelectionAsk onAsk={takeQuote} className="scroll-area flex min-h-0 flex-1 flex-col gap-4 pr-1">
        {chat.loading ? (
          <SkeletonChat />
        ) : !messages.length && !pending ? (
          <p className="py-10 text-center text-[13px] text-muted">{t('assistant.empty')}</p>
        ) : (
          messages.map((msg, i) => (
            <Appear key={msg.id} className="flex flex-col gap-1.5">
              <Message message={msg} onSave={lessonId ? () => saveToNotes(msg) : undefined} saveLabel={t('assistant.toNotes')} />
              {i === summarized - 1 && i < messages.length - 1 && (
                <div className="flex items-center gap-3 py-1 text-[11.5px] text-dim">
                  <span className="h-px flex-1 bg-line" />
                  {t('assistant.summaryDivider')}
                  <span className="h-px flex-1 bg-line" />
                </div>
              )}
            </Appear>
          ))
        )}
        {pending && (
          <>
            <UserBubble text={pending} />
            <div className="flex flex-col gap-2">
              <span className="label-caps animate-pulse-soft">{t('assistant.thinking')}</span>
              <SkeletonChat />
            </div>
          </>
        )}
        <div ref={endRef} />
      </SelectionAsk>

      <TrimNotice usage={chat.thread?.context} provider={provider} canGemini={keys.gemini} onGemini={() => setProvider('gemini')} />

      <form
        className="relative mt-2 flex flex-col gap-2 rounded-xl border border-line bg-surface p-2 focus-within:border-line-strong"
        onSubmit={(e) => {
          e.preventDefault()
          if (canSend) void ask('qa', question.trim())
        }}
      >
        <SlashMenu
          query={question.slice(1)}
          open={slashOpen}
          chat={chat}
          disabled={noSources}
          inputRef={inputRef}
          onClose={() => setQuestion('')}
          onQuick={(role) => {
            setQuestion('')
            void ask(role, '')
          }}
          onClearConfirmed={() => void clearChat()}
        />
        {quote && (
          <div className="flex items-start gap-2 rounded-lg border-l-2 border-fg bg-raised py-1.5 pr-1 pl-2.5">
            <div className="min-w-0 flex-1">
              <div className="label-caps mb-0.5">{t('assistant.quoteLabel')}</div>
              <p className="line-clamp-3 text-[12.5px] whitespace-pre-wrap text-soft">{quote}</p>
            </div>
            <IconButton icon={X} size="sm" label={t('common.cancel')} onClick={() => setQuote('')} />
          </div>
        )}
        {files.items.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1 pt-1">
            {files.items.map((d) => (
              <AttachmentChip key={d.key} draft={d} onRemove={() => files.remove(d.key)} />
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) files.add(e.target.files)
              e.target.value = ''
            }}
          />
          <AttachButton
            files={chat.thread?.files ?? []}
            attached={files.ids}
            disabled={noSources}
            onUpload={() => fileInput.current?.click()}
            onPick={files.addExisting}
          />
          {/* a key cap, not an icon: it says "type /" */}
          <button
            type="button"
            title={t('assistant.cmd.title')}
            aria-label={t('assistant.cmd.title')}
            onClick={() => {
              setQuestion('/')
              inputRef.current?.focus()
            }}
            className="mb-1 flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md border border-line px-1.5 font-mono text-[12px] leading-none text-muted transition-colors hover:border-line-strong hover:text-fg"
          >
            /
          </button>
          <textarea
            ref={inputRef}
            onPaste={(e) => {
              if (e.clipboardData.files.length) {
                e.preventDefault()
                files.add(e.clipboardData.files)
              }
            }}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
            rows={Math.min(6, Math.max(1, question.split('\n').length))}
            placeholder={t('assistant.placeholder')}
            disabled={noSources}
            className="read-14 max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-fg placeholder:text-dim focus:outline-none"
          />
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-fg text-bg disabled:opacity-30"
          >
            <Icon as={ArrowUp} size={16} />
          </button>
        </div>
      </form>
    </div>
  )
}

/** A quoted fragment ("> ...") at the start of a question renders as a quote block above the text. */
function splitQuote(text: string): { quote: string; rest: string } {
  const lines = text.split('\n')
  let i = 0
  while (i < lines.length && lines[i].startsWith('> ')) i++
  if (i === 0) return { quote: '', rest: text }
  return { quote: lines.slice(0, i).map((l) => l.slice(2)).join('\n'), rest: lines.slice(i).join('\n').trim() }
}

function UserBubble({ text, attachments = [] }: { text: string; attachments?: Attachment[] }) {
  const { quote, rest } = splitQuote(text)
  return (
    <div className="ml-auto flex max-w-[85%] flex-col items-end gap-1.5">
      {attachments.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {attachments.map((a) => <AttachmentChip key={a.id} attachment={a} />)}
        </div>
      )}
      <div className="read-14 rounded-xl rounded-br-sm bg-raised px-3.5 py-2 whitespace-pre-wrap text-fg">
        {quote && <p className="mb-1.5 line-clamp-4 border-l-2 border-muted pl-2.5 text-[12.5px] text-muted">{quote}</p>}
        {rest}
      </div>
    </div>
  )
}

function Message({ message, onSave, saveLabel }: { message: ChatMessage; onSave?: () => void; saveLabel: string }) {
  if (message.role === 'user') return <UserBubble text={message.content} attachments={message.attachments ?? []} />
  return (
    <div className={cn('group rounded-xl border border-line p-4')}>
      <MarkdownView content={message.content} compact />
      <footer className="mt-3 flex items-center justify-between gap-2 text-[11.5px] text-dim">
        <span className="font-mono">{message.model}</span>
        {onSave && (
          <button type="button" onClick={onSave} className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 hover:text-fg">
            <Icon as={NotebookPen} size={13} />
            {saveLabel}
          </button>
        )}
      </footer>
    </div>
  )
}

/**
 * The window did not hold all the material (a large course on DeepSeek's 64k, a small local window): said above the
 * input, with the numbers, so an answer "about the whole course" is not mistaken for one. Gemini's window is large.
 */
function TrimNotice({ usage, provider, canGemini, onGemini }: { usage?: ContextUsage | null; provider: AIProvider; canGemini: boolean; onGemini: () => void }) {
  const { t } = useUI()
  if (!usage?.sources_trimmed) return null
  const offer = provider !== 'gemini' && canGemini
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line-strong px-3.5 py-2.5">
      <Icon as={TriangleAlert} size={15} className="shrink-0 text-fg" />
      <p className="min-w-[12rem] flex-1 text-[12.5px] leading-snug text-soft">
        {t('assistant.trimmed', { whole: usage.sources_whole, count: usage.sources_count, pct: Math.max(1, Math.round(usage.sources_share * 100)) })}{' '}
        {t(provider === 'gemini' || !canGemini ? 'assistant.trimmedFixNoGemini' : 'assistant.trimmedFix')}
      </p>
      {offer && <Button size="sm" variant="secondary" onClick={onGemini}>{t('assistant.switchGemini')}</Button>}
    </div>
  )
}
