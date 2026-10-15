import { useSyncExternalStore } from 'react'
import { storage } from '@/lib/format'

export type PlayerMode = 'video' | 'audio'

export interface PlayerState {
  lessonId: string | null
  audioUrl: string | null
  videoUrl: string | null
  mode: PlayerMode
  currentTime: number
  duration: number
  playing: boolean
  rate: number
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

  load(lessonId: string, audioUrl: string | null, videoUrl: string | null) {
    if (this.state.lessonId === lessonId) return
    this.set({
      lessonId, audioUrl, videoUrl,
      mode: videoUrl ? 'video' : 'audio',
      currentTime: 0, duration: 0, playing: false,
    })
  }

  unload() {
    this.el?.pause()
    this.set({ lessonId: null, audioUrl: null, videoUrl: null, playing: false, currentTime: 0, duration: 0 })
  }

  /** Called by MediaPlayer whenever its element mounts/unmounts. */
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

  // element events
  onTime = (el: HTMLMediaElement) => this.set({ currentTime: el.currentTime })
  onDuration = (el: HTMLMediaElement) => this.set({ duration: Number.isFinite(el.duration) ? el.duration : 0 })
  onPlaying = (playing: boolean) => this.set({ playing })
}

export const player = new PlayerStore()

/** Subscribe to a slice of player state; re-renders only when the slice changes. */
export function usePlayer<T>(selector: (s: PlayerState) => T): T {
  return useSyncExternalStore(player.subscribe, () => selector(player.getState()))
}
