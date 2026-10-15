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
    create: async () => {
      const s = await api.newSession(kind, id)
      setSessionId(s.id)
      if (s.id === sessionId) await reload()
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
    toggleFile: async (fileId: string) => {
      const off = new Set(session?.excluded_files ?? [])
      if (off.has(fileId)) off.delete(fileId)
      else off.add(fileId)
      await api.patchSession(kind, id, sid, { excluded_files: [...off] })
      await reload()
    },
  }
}

export type ThreadApi = ReturnType<typeof useThread>
