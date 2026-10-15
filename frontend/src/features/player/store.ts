import { useCallback, useRef, useSyncExternalStore } from 'react'
import { storage } from '@/lib/format'

export type PlayerMode = 'video' | 'audio'
/** Where the video is shown: on the lesson page, in the floating in-app window, or in an always-on-top OS window. */
export type PlayerDisplay = 'inline' | 'window' | 'pip'

export interface Chapter { t: number; title: string }

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
  }
  private listeners = new Set<() => void>()
  private el: HTMLMediaElement | null = null
  private pendingSeek: { t: number; play: boolean } | null = null

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

  /** A lesson page opened. Another lesson takes the player over (a floating window of the previous one closes). */
  load(lessonId: string, audioUrl: string | null, videoUrl: string | null, title = '') {
    if (this.state.lessonId === lessonId) {
      if (title !== this.state.title) this.set({ title })
      return
    }
    this.el?.pause()
    this.set({
      lessonId, audioUrl, videoUrl, title,
      mode: videoUrl ? 'video' : 'audio',
      currentTime: 0, duration: 0, playing: false, display: 'inline', chapters: [],
    })
  }

  setChapters(chapters: Chapter[]) {
    this.set({ chapters })
  }

  /** The lesson page closed: keep playing if the video lives in a window, otherwise stop. */
  leave() {
    if (this.state.display === 'inline') this.unload()
  }

  unload() {
    this.el?.pause()
    this.set({ lessonId: null, audioUrl: null, videoUrl: null, playing: false, currentTime: 0, duration: 0, display: 'inline', chapters: [] })
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
  onTime = (el: HTMLMediaElement) => el === this.el && this.set({ currentTime: el.currentTime })
  onDuration = (el: HTMLMediaElement) => el === this.el && this.set({ duration: Number.isFinite(el.duration) ? el.duration : 0 })
  onPlaying = (el: HTMLMediaElement, playing: boolean) => el === this.el && this.set({ playing })
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
