import { useEffect, useRef, useState } from 'react'
import { api, type ThreadView } from '@/api/client'
import type { AIProvider, AskRequest, ThreadKind } from '@/api/types'
import { useResource } from '@/lib/useResource'
import { inFlight, pending, pendingKey, unloading, usePending } from './pending'

/** While a question waits and its request is not ours (it ran before a reload), the session is re-read this often. */
const POLL_MS = 3000

/**
 * One assistant thread (a lesson or a notebook) and its sessions. All server calls of the chat live here;
 * components only render. The read carries the same view as the next question (provider, selected sources),
 * so the context meter shows exactly what will be sent.
 */
export function useThread(kind: ThreadKind, id: string, provider: AIProvider, sources?: string[]) {
  const [sessionId, setSessionId] = useState<string | undefined>()
  const view: ThreadView = { session: sessionId, provider, sources: kind === 'project' ? sources : undefined }
  const res = useResource(() => api.thread(kind, id, view), [kind, id, sessionId, provider, view.sources?.join(',')], { keep: true })
  const thread = res.data
  const session = thread?.session
  const sid = session?.id ?? ''

  // id change of the thread itself: back to its active session
  const [owner, setOwner] = useState(`${kind}:${id}`)
  if (owner !== `${kind}:${id}`) {
    setOwner(`${kind}:${id}`)
    setSessionId(undefined)
  }

  const reload = res.reload

  // A question still waiting (asked before leaving the page or before a reload) shows as "thinking" until its answer
  // is in the session. Its request in this tab updates the store when done; one from before a reload is polled.
  const key = pendingKey(kind, id)
  const waiting = usePending(key)
  const last = session?.messages?.at(-1)
  const lastAnswerAt = last?.role === 'assistant' ? new Date(last.created_at ?? 0).getTime() : 0
  useEffect(() => {
    if (waiting && session && (!waiting.session || waiting.session === session.id)) pending.settle(key, lastAnswerAt)
  }, [waiting, session, lastAnswerAt, key])
  useEffect(() => {
    if (!waiting || inFlight.has(key)) return
    const timer = window.setInterval(() => void reload(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [waiting, key, reload])
  // the answer arrived while this view was showing an older read: read again
  const was = useRef(waiting)
  useEffect(() => {
    if (was.current && !waiting) void reload()
    was.current = waiting
  }, [waiting, reload])

  /** shown = what the chat shows for the question while it waits (a quick action has no text of its own) */
  const ask = async (req: Omit<AskRequest, 'session_id' | 'provider' | 'sources'>, shown = req.question ?? '') => {
    pending.set(key, { question: shown, session: sid, at: Date.now() })
    inFlight.add(key)
    try {
      res.setData(await api.ask(kind, id, { ...req, provider, session_id: sid || null, sources: view.sources ?? null }))
    } finally {
      inFlight.delete(key)
      // a reload cuts the request, not the answer: the server still saves it, the next page waits for it
      if (!unloading) pending.clear(key)
    }
  }

  return {
    thread,
    session,
    /** the question waiting for its answer in this session, if any (survives leaving the page and reloads) */
    waiting: waiting && (!waiting.session || waiting.session === sid) ? waiting.question : null,
    loading: res.loading && !thread,
    ask,
    select: async (next: string) => {
      await api.activateSession(kind, id, next)
      setSessionId(next)
    },
    /** A fresh session (an untouched empty one is reused); returns its id. */
    create: async (): Promise<string> => {
      const s = await api.newSession(kind, id)
      setSessionId(s.id)
      if (s.id === sessionId) await reload()
      return s.id
    },
    rename: async (target: string, title: string) => {
      await api.patchSession(kind, id, target, { title })
      await reload()
    },
    remove: async (target: string) => {
      await api.deleteSession(kind, id, target)
      if (target === sid) setSessionId(undefined)
      await reload()
    },
    clear: async () => {
      await api.clearSession(kind, id, sid)
      await reload()
    },
    compact: async () => res.setData(await api.compactSession(kind, id, sid, view)),
  }
}

export type ThreadApi = ReturnType<typeof useThread>
