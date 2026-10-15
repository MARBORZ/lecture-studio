import { useCallback, useRef, useSyncExternalStore } from 'react'
import type { Bookmark } from '@/api/types'
import { storage } from '@/lib/format'

export type PlayerMode = 'video' | 'audio'
/** Where the video is shown: on the lesson page, in the floating in-app window, or in an always-on-top OS window. */
export type PlayerDisplay = 'inline' | 'window' | 'pip'

export interface Chapter { t: number; title: string }
export type { Bookmark }

export interface PlayerState {
  lessonId: string | null
  audioUrl: string | null
  videoUrl: string | null
  mode: PlayerMode
  currentTime: number
  duration: number
  playing: boolean
  rate: number
  display: PlayerDisplay
  title: string
  chapters: Chapter[]
  bookmarks: Bookmark[]
  /** window display shrunk to a pill: paused, waiting to be continued */
  minimized: boolean
  /** the window was opened by leaving the lesson page (not by the user): coming back docks it again */
  autoPopped: boolean
}

/** Where each lesson was left: lesson id -> seconds on the clean timeline. Kept for the most recent lessons. */
const POSITIONS_KEY = 'player.positions'
const POSITIONS_MAX = 60
const positions = {
  get(lessonId: string): number {
    return storage.get<Record<string, number>>(POSITIONS_KEY, {})[lessonId] ?? 0
  },
  set(lessonId: string, t: number) {
    const all = storage.get<Record<string, number>>(POSITIONS_KEY, {})
    delete all[lessonId] // re-insert last: insertion order = recency
    all[lessonId] = Math.round(t * 10) / 10
    const keys = Object.keys(all)
    for (const k of keys.slice(0, Math.max(0, keys.length - POSITIONS_MAX))) delete all[k]
    storage.set(POSITIONS_KEY, all)
  },
}

const RATES = [1, 1.25, 1.5, 1.75, 2] as const

/**
 * One media element at a time, one clean timeline for both audio and video.
 * Switching mode carries currentTime/playing over to the other element.
 */
class PlayerStore {
  private state: PlayerState = {
    lessonId: null,
    audioUrl: null,
    videoUrl: null,
    mode: 'video',
    currentTime: 0,
    duration: 0,
    playing: false,
    rate: storage.get('player.rate', 1),
    display: 'inline',
    title: '',
    chapters: [],
    bookmarks: [],
    minimized: false,
    autoPopped: false,
  }
  private listeners = new Set<() => void>()
  private el: HTMLMediaElement | null = null
  private pendingSeek: { t: number; play: boolean } | null = null
  private savedAt = 0

  readonly rates = RATES

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getState = () => this.state

  private set(patch: Partial<PlayerState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((fn) => fn())
  }

  /**
   * A lesson page opened. Same lesson: a window it popped into on leaving docks back onto the page.
   * Another lesson takes the player over and starts where that lesson was left last time.
   */
  load(lessonId: string, audioUrl: string | null, videoUrl: string | null, title = '') {
    if (this.state.lessonId === lessonId) {
      if (title !== this.state.title) this.set({ title })
      if (this.state.autoPopped && this.state.display !== 'inline') {
        this.setDisplay('inline')
        this.set({ minimized: false, autoPopped: false })
      }
      return
    }
    this.remember()
    this.el?.pause()
    this.set({
      lessonId, audioUrl, videoUrl, title,
      mode: videoUrl ? 'video' : 'audio',
      currentTime: positions.get(lessonId), duration: 0, playing: false, display: 'inline', chapters: [], bookmarks: [],
      minimized: false, autoPopped: false,
    })
  }

  setBookmarks(bookmarks: Bookmark[]) {
    this.set({ bookmarks })
  }

  /** Store the current moment of the current lesson (throttled while playing, at once on pause/leave). */
  private remember(force = true) {
    const { lessonId, currentTime, duration } = this.state
    if (!lessonId) return
    const now = Date.now()
    if (!force && now - this.savedAt < 2000) return
    this.savedAt = now
    positions.set(lessonId, duration && currentTime > duration - 3 ? 0 : currentTime) // finished = start over next time
  }

  setChapters(chapters: Chapter[]) {
    this.set({ chapters })
  }

  /**
   * The lesson page closed. A window the user opened keeps going. Otherwise the player follows as a mini window:
   * still playing if it was playing, or minimized (paused, waiting) if it was paused somewhere in the middle.
   */
  leave() {
    this.remember()
    const { display, playing, currentTime, lessonId } = this.state
    if (!lessonId || display !== 'inline') return
    if (!playing && currentTime < 1) {
      this.unload()
      return
    }
    this.setDisplay('window')
    this.set({ autoPopped: true, minimized: !playing })
  }

  unload() {
    this.remember()
    this.el?.pause()
    this.set({
      lessonId: null, audioUrl: null, videoUrl: null, playing: false, currentTime: 0, duration: 0, display: 'inline',
      chapters: [], bookmarks: [], minimized: false, autoPopped: false,
    })
  }

  /** Shrink the window to a pill: pause and wait. */
  minimize() {
    this.el?.pause()
    this.pendingSeek = { t: this.el?.currentTime ?? this.state.currentTime, play: false }
    this.remember()
    this.set({ minimized: true, playing: false })
  }

  /** Back from the pill; play = continue right away. */
  restore(play = true) {
    this.pendingSeek = { t: this.state.currentTime, play }
    this.set({ minimized: false })
  }

  /** Move the video between page / floating window / OS window without losing the moment or the play state. */
  setDisplay(display: PlayerDisplay) {
    if (display === this.state.display) return
    this.pendingSeek = { t: this.el?.currentTime ?? this.state.currentTime, play: Boolean(this.el && !this.el.paused) }
    this.el?.pause()
    this.set({ display, ...(display !== 'inline' && this.state.videoUrl ? { mode: 'video' as const } : {}) })
  }

  /** Called through useMediaRef when a media element mounts. */
  attach(el: HTMLMediaElement | null) {
    if (this.el === el) return
    this.el = el
    if (!el) return
    el.playbackRate = this.state.rate
    const carry = this.pendingSeek ?? (this.state.currentTime > 0 ? { t: this.state.currentTime, play: this.state.playing } : null)
    this.pendingSeek = null
    if (carry) this.applySeek(el, carry.t, carry.play)
  }

  private applySeek(el: HTMLMediaElement, t: number, play: boolean) {
    const go = () => {
      el.currentTime = Math.min(t, Number.isFinite(el.duration) ? el.duration : t)
      if (play) void el.play().catch(() => undefined)
    }
    if (el.readyState >= 1) go()
    else el.addEventListener('loadedmetadata', go, { once: true })
  }

  seek(t: number, play = true) {
    this.set({ currentTime: t })
    if (this.el) this.applySeek(this.el, t, play)
    else this.pendingSeek = { t, play }
  }

  skip(delta: number) {
    this.seek(Math.max(0, this.state.currentTime + delta), this.state.playing)
  }

  toggle() {
    if (!this.el) return
    if (this.el.paused) void this.el.play().catch(() => undefined)
    else this.el.pause()
  }

  setMode(mode: PlayerMode) {
    if (mode === this.state.mode) return
    if (mode === 'video' && !this.state.videoUrl) return
    this.pendingSeek = { t: this.el?.currentTime ?? this.state.currentTime, play: Boolean(this.el && !this.el.paused) }
    this.el?.pause()
    this.set({ mode })
  }

  setRate(rate: number) {
    storage.set('player.rate', rate)
    if (this.el) this.el.playbackRate = rate
    this.set({ rate })
  }

  /** Unmount of a media element: forget it only if it is still the current one (an old element must not clear a new one). */
  detach(el: HTMLMediaElement) {
    if (this.el === el) this.el = null
  }

  get element() {
    return this.el
  }

  // element events — ignored unless they come from the current element (an outgoing element still fires pause/timeupdate)
  onTime = (el: HTMLMediaElement) => {
    if (el !== this.el) return
    this.set({ currentTime: el.currentTime })
    this.remember(false)
  }
  onDuration = (el: HTMLMediaElement) => el === this.el && this.set({ duration: Number.isFinite(el.duration) ? el.duration : 0 })
  onPlaying = (el: HTMLMediaElement, playing: boolean) => {
    if (el !== this.el) return
    this.set({ playing })
    if (!playing) this.remember()
  }
}

export const player = new PlayerStore()

/** Subscribe to a slice of player state; re-renders only when the slice changes. */
export function usePlayer<T>(selector: (s: PlayerState) => T): T {
  return useSyncExternalStore(player.subscribe, () => selector(player.getState()))
}

/** Ref callback for a <video>/<audio>: attaches on mount, detaches its own element on unmount. */
export function useMediaRef() {
  const own = useRef<HTMLMediaElement | null>(null)
  return useCallback((el: HTMLMediaElement | null) => {
    if (el) {
      own.current = el
      player.attach(el)
    } else if (own.current) {
      player.detach(own.current)
      own.current = null
    }
  }, [])
}

/** Shared media element event handlers (DRY for every place a video/audio element is rendered). */
export const mediaEvents = {
  onTimeUpdate: (e: React.SyntheticEvent<HTMLMediaElement>) => player.onTime(e.currentTarget),
  onLoadedMetadata: (e: React.SyntheticEvent<HTMLMediaElement>) => player.onDuration(e.currentTarget),
  onDurationChange: (e: React.SyntheticEvent<HTMLMediaElement>) => player.onDuration(e.currentTarget),
  onPlay: (e: React.SyntheticEvent<HTMLMediaElement>) => player.onPlaying(e.currentTarget, true),
  onPause: (e: React.SyntheticEvent<HTMLMediaElement>) => player.onPlaying(e.currentTarget, false),
  onEnded: (e: React.SyntheticEvent<HTMLMediaElement>) => player.onPlaying(e.currentTarget, false),
}
