import { FileText, ImageIcon, MessageSquareText, Paperclip, Send, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '@/api/client'
import type { FeedbackDraft, FeedbackSend } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { AnimatePresence, m } from '@/components/motion'
import { Button, Field, IconButton, Input, Modal, Progress, Segmented, Switch, Textarea } from '@/components/ui'
import { SkeletonText } from '@/components/skeleton'
import { SidebarAction } from '@/layouts/Sidebar'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/format'
import { shortcutLabel } from '@/lib/keys'
import { fadeUp } from '@/lib/motion'

type Kind = FeedbackSend['kind']
type Item = { key: string; name: string; size: number; progress: number; state: 'uploading' | 'done' }

/** Screenshots are shrunk before upload (longest side, JPEG quality): a Retina PNG of 5 MB becomes a few hundred KB. */
const SHRINK_SIDE = 2200
const SHRINK_FROM = 400 * 1024
const SHRINKABLE = ['image/png', 'image/jpeg', 'image/webp']

async function shrink(file: File): Promise<File> {
  if (!SHRINKABLE.includes(file.type) || file.size < SHRINK_FROM) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, SHRINK_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file // unreadable image: send as it is, the size check decides
  }
}

/** Sidebar entry: write to the developer (bugs, ideas), with screenshots and files. */
export function FeedbackButton() {
  const { t, openModal } = useUI()
  return <SidebarAction icon={MessageSquareText} label={t('feedback.button')} onClick={() => openModal((close) => <FeedbackModal close={close} />)} />
}

/**
 * The form. Opening it makes a draft on the server (which times the form: a bot sends at once); files upload into the
 * draft as they are added; limits (count, total size, types, cooldown) are checked here first and by the server again.
 * The hidden "website" field is a honeypot: a person never sees it, a form-filling bot fills it.
 */
function FeedbackModal({ close }: { close: () => void }) {
  const { t, toast, lang } = useUI()
  const [draft, setDraft] = useState<FeedbackDraft | null>(null)
  const [kind, setKind] = useState<Kind>('bug')
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState('')
  const [diagnostics, setDiagnostics] = useState(true)
  const [website, setWebsite] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [wait, setWait] = useState(0)
  const [sending, setSending] = useState(false)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const sent = useRef(false)

  useEffect(() => {
    api.feedbackDraft().then(
      (d) => {
        setDraft(d)
        setWait(d.retry_after)
      },
      (e) => toast((e as Error).message, 'error'),
    )
  }, [toast])

  // closing without sending throws the draft (and its files) away
  const id = draft?.id
  useEffect(() => () => void (id && !sent.current && api.feedbackDiscard(id).catch(() => undefined)), [id])

  // cooldown countdown
  useEffect(() => {
    if (wait <= 0) return
    const timer = window.setTimeout(() => setWait((s) => s - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [wait])

  const add = useCallback(
    async (files: File[]) => {
      if (!draft) return
      const { limits } = draft
      let count = items.length
      let total = items.reduce((sum, i) => sum + i.size, 0)
      for (const raw of files) {
        const ext = raw.name.includes('.') ? raw.name.slice(raw.name.lastIndexOf('.')).toLowerCase() : ''
        if (!limits.extensions.includes(ext)) {
          toast(t('feedback.badType', { name: raw.name, types: limits.extensions.join(' ') }), 'error')
          continue
        }
        if (count >= limits.max_files) {
          toast(t('feedback.tooMany', { n: limits.max_files }), 'error')
          break
        }
        const file = await shrink(raw)
        if (total + file.size > limits.max_total_bytes) {
          toast(t('feedback.tooBig', { mb: Math.round(limits.max_total_bytes / 1024 / 1024) }), 'error')
          continue
        }
        count += 1
        total += file.size
        const key = `${file.name}-${Date.now()}-${Math.random()}`
        setItems((list) => [...list.filter((i) => i.name !== file.name), { key, name: file.name, size: file.size, progress: 0, state: 'uploading' }])
        api
          .feedbackFile(draft.id, file, (p) => setItems((list) => list.map((i) => (i.key === key ? { ...i, progress: p } : i))))
          .promise.then(
            (res) => setItems((list) => list.map((i) => (i.key === key ? { ...i, name: res.name, size: res.size, state: 'done' } : i))),
            (e) => {
              setItems((list) => list.filter((i) => i.key !== key))
              toast((e as Error).message, 'error')
            },
          )
      }
    },
    [draft, items, t, toast],
  )

  // screenshots straight from the clipboard
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? [])
      if (!files.length) return
      e.preventDefault()
      void add(files.map((f, i) => (f.name === 'image.png' ? new File([f], `screenshot-${Date.now()}-${i}.png`, { type: f.type }) : f)))
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [add])

  function remove(item: Item) {
    setItems((list) => list.filter((i) => i.key !== item.key))
    if (draft && item.state === 'done') void api.feedbackRemoveFile(draft.id, item.name).catch(() => undefined)
  }

  const limits = draft?.limits
  const short = limits ? Math.max(0, limits.min_message - message.trim().length) : 0
  const uploading = items.some((i) => i.state === 'uploading')
  const canSend = Boolean(draft) && !short && !uploading && wait <= 0 && !sending

  async function send() {
    if (!draft || !canSend) return
    setSending(true)
    try {
      const res = await api.feedbackSend(draft.id, { kind, message, contact, diagnostics, website })
      sent.current = true
      toast(res.status === 'sent' ? t('feedback.sent') : t('feedback.queued'))
      close()
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        const sec = Number(String(e.message).match(/\d+/)?.[0] ?? 60)
        setWait(sec)
      }
      toast((e as Error).message, 'error')
      setSending(false)
    }
  }

  return (
    <Modal
      title={t('feedback.title')}
      description={t('feedback.description')}
      onClose={close}
      footer={
        <>
          {wait > 0 && <span className="mr-auto text-[12px] text-muted tabular-nums">{t('feedback.wait', { sec: wait })}</span>}
          <Button variant="ghost" onClick={close}>{t('common.cancel')}</Button>
          <Button variant="primary" icon={Send} loading={sending} disabled={!canSend} onClick={send}>
            {t('feedback.send')}
          </Button>
        </>
      }
    >
      {!limits ? (
        <SkeletonText lines={5} />
      ) : (
        <div className="relative flex flex-col gap-5">
          <Segmented
            value={kind}
            onChange={setKind}
            options={(['bug', 'idea', 'other'] as const).map((k) => ({ value: k, label: t(`feedback.kind.${k}`) }))}
          />
          <Field label={t('feedback.message')} aside={short ? t('feedback.minLength', { n: short }) : `${message.length}/${limits.max_message}`}>
            <Textarea
              value={message}
              maxLength={limits.max_message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t(`feedback.placeholder.${kind}`)}
              rows={6}
              autoFocus
            />
          </Field>

          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] text-soft">{t('feedback.files')}</span>
              <span className="text-[11.5px] text-dim">
                {t('feedback.filesHint', { n: limits.max_files, mb: Math.round(limits.max_total_bytes / 1024 / 1024), paste: shortcutLabel('V') })}
              </span>
            </div>
            <button
              type="button"
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setOver(true)
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setOver(false)
                void add(Array.from(e.dataTransfer.files))
              }}
              className={cn(
                'flex items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-4 text-[12.5px] transition-colors',
                over ? 'border-fg bg-raised text-fg' : 'border-line-strong text-muted hover:border-muted hover:text-soft',
              )}
            >
              <Icon as={Paperclip} size={15} />
              {t('feedback.drop')}
            </button>
            <input
              ref={input}
              type="file"
              multiple
              accept={limits.extensions.join(',')}
              className="hidden"
              onChange={(e) => {
                void add(Array.from(e.target.files ?? []))
                e.target.value = ''
              }}
            />
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <m.div key={item.key} variants={fadeUp} initial="hidden" animate="show" exit="exit" className="flex flex-col gap-1.5 rounded-lg border border-line px-3 py-2">
                  <div className="flex items-center gap-2.5 text-[12.5px]">
                    <Icon as={/\.(png|jpe?g|webp|gif|heic)$/i.test(item.name) ? ImageIcon : FileText} size={14} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate text-fg">{item.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-muted">{formatBytes(item.size, lang)}</span>
                    <IconButton icon={X} size="sm" label={t('common.delete')} onClick={() => remove(item)} />
                  </div>
                  {item.state === 'uploading' && <Progress value={item.progress * 100} />}
                </m.div>
              ))}
            </AnimatePresence>
          </div>

          <Field label={t('feedback.contact')}>
            <Input value={contact} maxLength={limits.max_contact} onChange={(e) => setContact(e.target.value)} placeholder={t('feedback.contactPlaceholder')} />
          </Field>
          <Switch checked={diagnostics} onChange={setDiagnostics} label={t('feedback.diagnostics')} hint={t('feedback.diagnosticsHint')} />

          {/* honeypot: off-screen, out of the tab order, ignored by password managers */}
          <input
            type="text"
            name="website"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden
            className="pointer-events-none absolute -left-[9999px] h-px w-px opacity-0"
          />
        </div>
      )}
    </Modal>
  )
}
