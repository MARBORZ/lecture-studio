import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router'
import type { Lesson, LessonFull } from '@/api/types'
import { useJobs, useLibrary, useUI } from '@/app/AppProvider'
import { player } from '@/features/player/store'
import { useHotkey } from '@/features/hotkeys/useHotkey'
import { isTyping } from '@/lib/keys'
import type { Chapter } from '@/features/player/MediaPlayer'

/**
 * The lesson page's behaviour, out of its layout: focus-mode keys, the player fed with this lesson, reloads when the
 * lesson changed elsewhere (a finished job, Claude through MCP).
 */

/** Focus mode: its hotkey toggles (F by default), Esc leaves (unless a dialog is open); leaving the lesson ends it. */
export function useFocusKeys() {
  const { setFocusMode, modals } = useUI()
  useHotkey('lesson.focus', () => setFocusMode((v) => !v))
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape' && !modals.length) setFocusMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setFocusMode, modals.length])
  useEffect(() => () => setFocusMode(false), [setFocusMode])
}

/** The player plays this lesson: media, chapters and bookmarks; a ?t= deep link seeks once; leaving stops it. */
export function useLessonInPlayer(lessonId: string, lesson: LessonFull | null | undefined, chapters: Chapter[], bookmarks: Lesson['bookmarks'] | undefined) {
  const [search, setSearch] = useSearchParams()
  useEffect(() => {
    if (!lesson) return
    player.load(lesson.id, lesson.audio_url ?? null, lesson.video_url ?? null, lesson.title ?? '')
    const t0 = search.get('t')
    if (t0) {
      player.seek(Number(t0), true)
      setSearch((p) => (p.delete('t'), p), { replace: true })
    }
  }, [lesson, search, setSearch])
  useEffect(() => {
    if (lesson && player.getState().lessonId === lesson.id) player.setChapters(chapters)
  }, [lesson, chapters])
  useEffect(() => {
    if (lesson && player.getState().lessonId === lesson.id) player.setBookmarks(bookmarks ?? [])
  }, [lesson, bookmarks])
  // Leaving the page stops playback unless the video is out in a window (then it keeps playing).
  useEffect(() => () => player.leave(), [lessonId])
}

/** Reload the lesson when a job for it finishes (e.g. audit regeneration) or Claude changed the library through MCP. */
export function useReloadOnChange(lessonId: string, reload: () => Promise<void>) {
  const { jobs } = useJobs()
  const { revision } = useLibrary()
  const finished = jobs.filter((j) => j.lesson_id === lessonId && j.status === 'completed').length
  const seen = useRef(finished)
  useEffect(() => {
    if (finished > seen.current) void reload()
    seen.current = finished
  }, [finished, reload])
  // ...and when Claude changed the library through MCP (an audit, a transcript, the title)
  const seenRevision = useRef(revision)
  useEffect(() => {
    if (revision === seenRevision.current) return
    seenRevision.current = revision
    void reload()
  }, [revision, reload])
}
