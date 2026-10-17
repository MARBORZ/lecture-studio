import { useEffect, useRef, useState } from 'react'
import type { AIProvider, ChatSession, ThreadKind } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { pickProvider, PROVIDER_NAME, useAiKeys } from '@/features/system/KeyNotice'
import { storage } from '@/lib/format'

/**
 * The model chosen in a chat is kept per session (this browser), and as the last choice of the chat (lesson or
 * notebook). Opening a chat or switching sessions brings back, in order: the session's own choice, the model of its
 * last answer, the chat's last choice, then the default from Settings → AI (or one that is set up).
 */
const sessionKey = (sid: string) => `assistant.provider.session.${sid}`
const threadKey = (kind: ThreadKind, id: string) => `assistant.provider.${kind}.${id}`
const known = (p: unknown): p is AIProvider => typeof p === 'string' && p in PROVIDER_NAME

export function useChatProvider(kind: ThreadKind, id: string) {
  const { settings } = useUI()
  const keys = useAiKeys()
  const [provider, setProvider] = useState<AIProvider>(() => {
    const last = storage.get<string>(threadKey(kind, id), '')
    return known(last) ? last : pickProvider(settings?.ai.assistant_provider ?? 'deepseek', keys)
  })

  /** The user picked a model: it sticks to this session and becomes the chat's last choice. */
  function choose(p: AIProvider, sid?: string) {
    setProvider(p)
    storage.set(threadKey(kind, id), p)
    if (sid) storage.set(sessionKey(sid), p)
  }

  return { provider, choose, setProvider }
}

/** On opening or switching a session: its own choice, else the model that wrote its last answer. Only when the session
 *  changes: a new answer must not override a model picked a moment ago. */
export function useRestoreProvider(session: ChatSession | null | undefined, setProvider: (p: AIProvider) => void) {
  const latest = useRef(session)
  useEffect(() => {
    latest.current = session
  })
  const sid = session?.id ?? ''
  useEffect(() => {
    if (!sid) return
    const own = storage.get<string>(sessionKey(sid), '')
    const answered = [...(latest.current?.messages ?? [])].reverse().find((m) => m.role === 'assistant' && m.provider)?.provider
    const p = known(own) ? own : known(answered) ? answered : undefined
    if (p) setProvider(p)
  }, [sid, setProvider])
}
