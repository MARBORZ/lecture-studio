/**
 * Self-update state, an external store like the player.
 *   info   — newest release vs the running version (GET /api/system/update, cached by the server for an hour)
 *   phase  — set while the launcher restarts everything. Kept in sessionStorage: when the code changes under
 *            the running Vite server the page reloads, and the waiting screen must come back.
 */
import { useSyncExternalStore } from 'react'
import { api } from '@/api/client'
import type { UpdateInfo } from '@/api/types'

export interface UpdatePhase {
  to: string
  pid: number // server pid before the restart: a different pid answering = restarted
  since: number
}

interface State {
  info: UpdateInfo | null
  checking: boolean
  phase: UpdatePhase | null
}

const PHASE_KEY = 'ls.updating'

function readPhase(): UpdatePhase | null {
  try {
    const raw = sessionStorage.getItem(PHASE_KEY)
    return raw ? (JSON.parse(raw) as UpdatePhase) : null
  } catch {
    return null
  }
}

function writePhase(phase: UpdatePhase | null) {
  try {
    if (phase) sessionStorage.setItem(PHASE_KEY, JSON.stringify(phase))
    else sessionStorage.removeItem(PHASE_KEY)
  } catch {
    /* private mode: the screen just won't survive a reload */
  }
}

class UpdateStore {
  private state: State = { info: null, checking: false, phase: readPhase() }
  private listeners = new Set<() => void>()

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getState = () => this.state

  private set(patch: Partial<State>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((fn) => fn())
  }

  async check(force = false, reload = false): Promise<UpdateInfo> {
    this.set({ checking: true })
    try {
      const info = await api.update(force, reload)
      this.set({ info })
      return info
    } finally {
      this.set({ checking: false })
    }
  }

  /** Reset the modified files that block the update (the server decides which); the dialog follows the fresh info. */
  async discard(): Promise<UpdateInfo> {
    const info = await api.discardUpdateChanges()
    this.set({ info })
    return info
  }

  /** Server moves the code and starts the launcher; we wait for a new server pid. */
  async apply() {
    const { pid } = await api.status()
    const info = await api.applyUpdate()
    const phase = { to: info.latest ?? '', pid, since: Date.now() }
    writePhase(phase)
    this.set({ phase })
  }

  finish() {
    writePhase(null)
    this.set({ phase: null })
  }
}

export const updates = new UpdateStore()

export function useUpdates<T>(select: (s: State) => T): T {
  return useSyncExternalStore(updates.subscribe, () => select(updates.getState()))
}
