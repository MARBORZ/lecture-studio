import { BookmarkPlus, Pencil, Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { useLibrary, useUI } from '@/app/AppProvider'
import { IconButton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatTc } from '@/lib/time'
import { player, usePlayer, type Bookmark } from './store'

export const BOOKMARK_LABEL_MAX = 20

/**
 * The user's own marks on the clean timeline (named, up to 20 characters), stored with the lesson.
 * Works wherever the player is: the page, the floating window, the always-on-top window.
 */
export function useBookmarks() {
  const { t, promptText, toast } = useUI()
  const { patchLesson } = useLibrary()
  const lessonId = usePlayer((s) => s.lessonId)
  const bookmarks = usePlayer((s) => s.bookmarks)

  const save = useCallback(
    (list: Bookmark[]) => {
      if (!lessonId) return
      const before = player.getState().bookmarks
      const sorted = list.map((b) => ({ ...b, label: (b.label ?? '').slice(0, BOOKMARK_LABEL_MAX) })).sort((a, b) => a.t - b.t)
      player.setBookmarks(sorted) // optimistic: the marker appears at once, and goes away if saving fails
      patchLesson(lessonId, { bookmarks: sorted }).catch((e: Error) => {
        if (player.getState().lessonId === lessonId) player.setBookmarks(before)
        toast(e.message, 'error')
      })
    },
    [lessonId, patchLesson, toast],
  )

  const ask = (title: string, initial: string, at: number) =>
    promptText({ title, label: `${t('bookmark.at')} ${formatTc(at)}`, initial, maxLength: BOOKMARK_LABEL_MAX, confirmLabel: t('common.save') })

  return {
    bookmarks,
    add: async () => {
      if (!lessonId) return
      const at = player.getState().currentTime
      const label = await ask(t('bookmark.add'), t('bookmark.default', { n: bookmarks.length + 1 }), at)
      if (label) save([...bookmarks, { id: Math.random().toString(36).slice(2, 10), t: Math.round(at * 10) / 10, label }])
    },
    rename: async (b: Bookmark) => {
      const label = await ask(t('bookmark.rename'), b.label ?? '', b.t)
      if (label) save(bookmarks.map((x) => (x.id === b.id ? { ...x, label } : x)))
    },
    remove: (b: Bookmark) => save(bookmarks.filter((x) => x.id !== b.id)),
  }
}

export function BookmarkButton() {
  const { t } = useUI()
  const { add } = useBookmarks()
  return <IconButton icon={BookmarkPlus} label={`${t('bookmark.add')} (M)`} onClick={() => void add()} />
}

/** The list under the player: click = jump, hover = rename / delete. */
export function BookmarkList() {
  const { t } = useUI()
  const { bookmarks, rename, remove } = useBookmarks()
  const current = usePlayer((s) => s.currentTime)
  if (!bookmarks.length) return <p className="px-2 py-1 text-[12.5px] text-dim">{t('bookmark.empty')}</p>
  return (
    <ol className="flex flex-col">
      {bookmarks.map((b) => (
        <li key={b.id} className="group flex items-center gap-1">
          <button
            type="button"
            onClick={() => player.seek(b.t, true)}
            className={cn('flex min-w-0 flex-1 items-baseline gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-surface', Math.abs(current - b.t) < 1 ? 'text-fg' : 'text-soft')}
          >
            <span className="w-12 shrink-0 font-mono text-[11.5px] text-dim">{formatTc(b.t)}</span>
            <span className="min-w-0 truncate">{b.label}</span>
          </button>
          <IconButton icon={Pencil} size="sm" label={t('bookmark.rename')} className="opacity-0 group-hover:opacity-100" onClick={() => void rename(b)} />
          <IconButton icon={Trash2} size="sm" label={t('bookmark.delete')} className="opacity-0 group-hover:opacity-100" onClick={() => remove(b)} />
        </li>
      ))}
    </ol>
  )
}
