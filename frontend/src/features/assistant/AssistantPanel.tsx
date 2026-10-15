import { ArrowUp, NotebookPen, Paperclip, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/api/client'
import type { AIProvider, AssistantRole, Attachment, ChatMessage } from '@/api/types'
import { useLibrary, useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Appear } from '@/components/motion'
import { Button, IconButton, Segmented } from '@/components/ui'
import { SkeletonChat } from '@/components/skeleton'
import { MarkdownView } from '@/features/markdown/MarkdownView'
import { KeyNotice } from '@/features/system/KeyNotice'
import { cn } from '@/lib/cn'
import { useResource } from '@/lib/useResource'
import { AttachmentChip, useAttachments } from './attachments'

const ROLES: Exclude<AssistantRole, 'qa'>[] = ['key_moments', 'pitfalls', 'code_summary', 'quiz', 'chapters']

/**
 * Grounded chat over lesson sources.
 *   kind="lesson"  — one lesson, citations [MM:SS] seek the player
 *   kind="project" — selected lessons of a notebook, citations [[lesson@MM:SS]] open the lesson
 */
export function AssistantPanel({ kind, id, sources, lessonId }: { kind: 'lesson' | 'project'; id: string; sources?: string[]; lessonId?: string }) {
  const { t, settings, toast, confirm } = useUI()
  const { patchLesson, lessons } = useLibrary()
  const thread = useResource(() => api.thread(kind, id), [kind, id])
  const [question, setQuestion] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [provider, setProvider] = useState<AIProvider>(settings?.ai.assistant_provider ?? 'deepseek')
  const files = useAttachments()
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const messages = thread.data?.messages ?? []

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, pending])

  async function ask(role: AssistantRole, text: string) {
    if (pending || files.uploading) return
    setPending(text || t(`assistant.role.${role as Exclude<AssistantRole, 'qa'>}`))
    setQuestion('')
    try {
      const added = await api.ask(kind, id, { question: text, role, sources: kind === 'project' ? sources ?? null : null, provider, attachments: files.ids })
      thread.setData((prev) => ({ kind, id, messages: [...(prev?.messages ?? []), ...added] }))
      files.clear()
    } catch (e) {
      toast((e as Error).message, 'error')
      setQuestion(text)
    } finally {
      setPending(null)
    }
  }

  async function saveToNotes(m: ChatMessage) {
    if (!lessonId) return
    const current = lessons.find((l) => l.id === lessonId)?.notes ?? ''
    await patchLesson(lessonId, { notes: [current.trim(), m.content.trim()].filter(Boolean).join('\n\n---\n\n') })
    toast(t('assistant.addedToNotes'))
  }

  const noSources = kind === 'project' && sources?.length === 0
  const canSend = (Boolean(question.trim()) || files.ids.length > 0) && !pending && !files.uploading

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
      <div className="flex flex-wrap items-center gap-2 pb-3">
        {ROLES.map((r) => (
          <Button key={r} size="sm" variant="secondary" disabled={Boolean(pending) || noSources} onClick={() => ask(r, '')}>
            {t(`assistant.role.${r}`)}
          </Button>
        ))}
        <div className="flex-1" />
        <Segmented size="sm" value={provider} onChange={setProvider} options={[{ value: 'deepseek', label: 'DeepSeek' }, { value: 'gemini', label: 'Gemini' }]} />
        <IconButton
          icon={Trash2}
          size="sm"
          label={t('assistant.clear')}
          disabled={!messages.length}
          onClick={async () => {
            if (await confirm({ title: t('assistant.clear'), text: t('assistant.clearText'), danger: true, confirmLabel: t('common.delete') })) {
              await api.clearThread(kind, id)
              thread.setData({ kind, id, messages: [] })
            }
          }}
        />
      </div>

      <KeyNotice provider={provider} className="mb-3" />

      <div className="scroll-area flex min-h-0 flex-1 flex-col gap-4 pr-1">
        {thread.loading && !thread.data ? (
          <SkeletonChat />
        ) : !messages.length && !pending ? (
          <p className="py-10 text-center text-[13px] text-muted">{t('assistant.empty')}</p>
        ) : (
          messages.map((msg) => (
            <Appear key={msg.id} className="flex flex-col gap-1.5">
              <Message message={msg} onSave={lessonId ? () => saveToNotes(msg) : undefined} saveLabel={t('assistant.toNotes')} />
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
      </div>

      <form
        className="mt-3 flex flex-col gap-2 rounded-xl border border-line bg-surface p-2 focus-within:border-line-strong"
        onSubmit={(e) => {
          e.preventDefault()
          if (canSend) void ask('qa', question.trim())
        }}
      >
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
        <IconButton icon={Paperclip} size="sm" label={t('assistant.attach')} disabled={noSources} onClick={() => fileInput.current?.click()} className="mb-0.5" />
        <textarea
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
          className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-[14px] text-fg placeholder:text-dim focus:outline-none"
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

function UserBubble({ text, attachments = [] }: { text: string; attachments?: Attachment[] }) {
  return (
    <div className="ml-auto flex max-w-[85%] flex-col items-end gap-1.5">
      {attachments.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {attachments.map((a) => <AttachmentChip key={a.id} attachment={a} />)}
        </div>
      )}
      {text && <div className="rounded-xl rounded-br-sm bg-raised px-3.5 py-2 text-[14px] whitespace-pre-wrap text-fg">{text}</div>}
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
