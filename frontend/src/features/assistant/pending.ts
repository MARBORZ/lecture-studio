import { useSyncExternalStore } from 'react'
import { storage } from '@/lib/format'

/**
 * Questions still waiting for an answer, outside React: leaving the chat (another tab, route or a reload) does not
 * lose them. The request itself keeps running — in this tab it is a promise nobody cancels, after a reload the server
 * finishes it anyway (it saves the answer into the session) — and the chat shows "thinking" again until the answer is
 * in the session. Kept in localStorage, one per thread (the chat sends one question at a time).
 */
export interface Pending {
  question: string
  /** the session it went to ("" = a new one the answer creates) */
  session: string
  at: number
}

const KEY = 'assistant.pending'
/** A question older than this is given up (the server failed or was restarted mid-answer). */
const GIVE_UP_MS = 15 * 60 * 1000
/** created_at is stored to the second: an answer stamped up to this much before the question still counts */
const SKEW_MS = 1500

type State = Record<string, Pending>
const listeners = new Set<() => void>()
let state: State = load()

function load(): State {
  const now = Date.now()
  return Object.fromEntries(Object.entries(storage.get<State>(KEY, {})).filter(([, p]) => now - p.at < GIVE_UP_MS))
}

function save(next: State) {
  state = next
  storage.set(KEY, next)
  listeners.forEach((fn) => fn())
}

export const pendingKey = (kind: string, id: string) => `${kind}:${id}`

/** Requests running in this tab (a reload loses them: then the chat polls the session instead). */
export const inFlight = new Set<string>()

/** The page is going away (reload, close): its requests are cut, but their questions still wait on the server. */
export let unloading = false
window.addEventListener('pagehide', () => (unloading = true))
window.addEventListener('beforeunload', () => (unloading = true))

export const pending = {
  get: (key: string): Pending | undefined => state[key],
  set: (key: string, p: Pending) => save({ ...state, [key]: p }),
  clear: (key: string) => {
    if (!(key in state)) return
    const rest = { ...state }
    delete rest[key]
    save(rest)
  },
  /** The session's last message is an answer written after the question went (server time, local clock): done. */
  settle: (key: string, lastAnswerAt: number) => {
    const p = state[key]
    if (p && lastAnswerAt >= p.at - SKEW_MS) pending.clear(key)
  },
  subscribe: (fn: () => void) => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}

// another window of the app (the pop-out player keeps its own) sees the same questions
window.addEventListener('storage', (e) => {
  if (e.key === KEY) {
    state = load()
    listeners.forEach((fn) => fn())
  }
})

export function usePending(key: string): Pending | undefined {
  return useSyncExternalStore(pending.subscribe, () => (key ? state[key] : undefined))
}
