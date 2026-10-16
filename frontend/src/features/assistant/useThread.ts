import { useState } from 'react'
import { api, type ThreadView } from '@/api/client'
import type { AIProvider, AskRequest, ThreadKind } from '@/api/types'
import { useResource } from '@/lib/useResource'

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

  const ask = async (req: Omit<AskRequest, 'session_id' | 'provider' | 'sources'>) => {
    res.setData(await api.ask(kind, id, { ...req, provider, session_id: sid || null, sources: view.sources ?? null }))
  }

  return {
    thread,
    session,
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
