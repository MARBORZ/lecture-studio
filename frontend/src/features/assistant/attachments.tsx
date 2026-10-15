import { File, FileText, Image as ImageIcon, LoaderCircle, X } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { api } from '@/api/client'
import type { Attachment } from '@/api/types'
import { useJobs, useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/format'

export interface DraftAttachment {
  key: number
  name: string
  size: number
  progress: number
  attachment?: Attachment
  error?: string
}

let seq = 0

/** Draft attachments of the message being written: upload on add (with progress), remove, clear after send. */
export function useAttachments() {
  const { toast } = useUI()
  const { trackUpload } = useJobs()
  const [items, setItems] = useState<DraftAttachment[]>([])
  const aborts = useRef(new Map<number, () => void>())

  const patch = (key: number, p: Partial<DraftAttachment>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)))

  const add = useCallback((files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const key = ++seq
      setItems((list) => [...list, { key, name: file.name, size: file.size, progress: 0 }])
      const tracker = trackUpload(file.name) // counts for the shutdown guard and the sidebar indicator
      const handle = api.uploadAttachment(file, (f) => {
        tracker.progress(f)
        patch(key, { progress: f })
      })
      aborts.current.set(key, handle.abort)
      handle.promise
        .then((attachment) => patch(key, { attachment, progress: 1 }))
        .catch((e: Error) => {
          patch(key, { error: e.message })
          toast(`${file.name}: ${e.message}`, 'error')
        })
        .finally(() => {
          tracker.done()
          aborts.current.delete(key)
        })
    }
  }, [toast, trackUpload])

  const remove = useCallback((key: number) => {
    aborts.current.get(key)?.()
    setItems((list) => list.filter((i) => i.key !== key))
  }, [])

  const clear = useCallback(() => setItems([]), [])

  return {
    items,
    add,
    remove,
    clear,
    ids: items.flatMap((i) => (i.attachment ? [i.attachment.id] : [])),
    uploading: items.some((i) => !i.attachment && !i.error),
  }
}

const KIND_ICON = { text: FileText, document: FileText, image: ImageIcon, binary: File } as const

/** One chip for a draft or a sent attachment. Sent chips link to the file. */
export function AttachmentChip({ draft, attachment, onRemove }: { draft?: DraftAttachment; attachment?: Attachment; onRemove?: () => void }) {
  const { lang } = useUI()
  const att = attachment ?? draft?.attachment
  const name = att?.name ?? draft?.name ?? ''
  const loading = draft && !draft.attachment && !draft.error
  const body = (
    <>
      <Icon as={loading ? LoaderCircle : KIND_ICON[att?.kind ?? 'binary']} size={14} className={cn('shrink-0', loading && 'animate-spin')} />
      <span className="min-w-0 truncate">{name}</span>
      <span className="shrink-0 font-mono text-[10.5px] text-dim">
        {loading ? `${Math.round((draft!.progress ?? 0) * 100)}%` : draft?.error ? '!' : formatBytes(att?.size ?? draft?.size ?? 0, lang)}
      </span>
    </>
  )
  const cls = cn(
    'flex max-w-60 items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px]',
    draft?.error ? 'border-fg text-fg' : 'border-line-strong text-soft',
  )
  return (
    <span title={draft?.error ?? att?.note ?? name} className="inline-flex items-center gap-0.5">
      {attachment ? (
        <a href={api.attachmentUrl(attachment.id)} download className={cn(cls, 'hover:border-fg hover:text-fg')}>{body}</a>
      ) : (
        <span className={cls}>{body}</span>
      )}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label="Remove" className="flex size-6 items-center justify-center rounded-md text-dim hover:bg-hover hover:text-fg">
          <Icon as={X} size={12} />
        </button>
      )}
    </span>
  )
}
