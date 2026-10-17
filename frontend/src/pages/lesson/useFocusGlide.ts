import { useEffect, useLayoutEffect, useRef } from 'react'
import { flip, glide, restoreAnchor, scrollAnchor, type ScrollAnchor } from '@/lib/motion'

/**
 * Focus mode: the page changes in one step, then the player glides from where it was to where it is now, and the
 * tab pane slides along and fades in over its reflow, still showing the paragraph the reader was on. While leaving
 * focus the video comes from a bigger box: its column must not clip it. Pressed again mid-way, the way back starts
 * from where things are on screen. Returns the refs to put on the player, the tab pane and the player's column.
 */
export function useFocusGlide(focusMode: boolean) {
  const playerRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLElement>(null)
  const asideRef = useRef<HTMLElement>(null)
  const last = useRef<{ player: DOMRect | null; pane: DOMRect | null; anchor: ScrollAnchor | null }>({ player: null, pane: null, anchor: null })
  const lastFocus = useRef(focusMode)
  const tracking = useRef(0)
  const lift = useRef(0)
  const measure = () => ({
    player: playerRef.current?.getBoundingClientRect() ?? null,
    pane: paneRef.current?.getBoundingClientRect() ?? null,
    anchor: scrollAnchor(paneRef.current),
  })
  useLayoutEffect(() => {
    const el = playerRef.current
    const pane = paneRef.current
    if (lastFocus.current !== focusMode) {
      restoreAnchor(last.current.anchor)
      const running = [
        el && last.current.player ? flip(el, last.current.player) : undefined,
        pane && last.current.pane ? glide(pane, last.current.pane) : undefined,
      ].filter((a): a is Animation => Boolean(a))
      // the video glides in from a bigger box (leaving focus): its column must not clip it, and it rides above the pane
      const aside = asideRef.current
      if (el && aside && running.length && aside.scrollTop === 0) {
        aside.style.overflow = 'visible'
        el.style.position = 'relative'
        el.style.zIndex = '20'
        const turn = ++lift.current
        void Promise.allSettled(running.map((a) => a.finished)).then(() => {
          if (turn !== lift.current) return // a newer glide owns these styles now
          aside.style.overflow = ''
          el.style.position = ''
          el.style.zIndex = ''
        })
      }
      // while they glide, keep the on-screen boxes: pressed again mid-way, the way back starts from there
      cancelAnimationFrame(tracking.current)
      const track = () => {
        last.current = measure()
        if (running.some((a) => a.playState === 'running')) tracking.current = requestAnimationFrame(track)
      }
      tracking.current = requestAnimationFrame(track)
    }
    lastFocus.current = focusMode
    last.current = measure()
  })
  useEffect(() => () => cancelAnimationFrame(tracking.current), [])
  useEffect(() => {
    let frame = 0
    const remember = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        last.current = measure()
      })
    }
    window.addEventListener('resize', remember)
    window.addEventListener('scroll', remember, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', remember)
      window.removeEventListener('scroll', remember, true)
    }
  }, [])
  return { playerRef, paneRef, asideRef }
}
