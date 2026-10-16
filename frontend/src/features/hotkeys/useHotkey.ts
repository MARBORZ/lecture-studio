import { useCallback, useEffect, useRef } from 'react'
import { useUI } from '@/app/AppProvider'
import { blockedByTyping, comboLabel, matches, type HotkeyAction } from '@/lib/hotkeys'

/** What an action is bound to now ("" = off, or while the settings load). */
export function useHotkeyCombo(action: HotkeyAction): string {
  const { settings } = useUI()
  return settings?.hotkeys.find((h) => h.id === action)?.combo ?? ''
}

/** The current combination of an action as it reads ("⌘B", "Space"→ the localized name); "" when off. */
export function useHotkeyLabel(action: HotkeyAction): string {
  const { t } = useUI()
  return comboLabel(useHotkeyCombo(action), t('hotkey.key.space'))
}

/** A label with the combination in brackets when the action has one: "Focus mode (F)". */
export function useWithHotkey(action: HotkeyAction): (label: string) => string {
  const key = useHotkeyLabel(action)
  return useCallback((label: string) => (key ? `${label} (${key})` : label), [key])
}

interface Options {
  target?: Window | null // the window that listens (the always-on-top player window has its own)
  enabled?: boolean
  repeat?: boolean // fire again while the key is held (seeking); toggles fire once per press
  when?: (e: KeyboardEvent) => boolean // extra condition at the moment of the press
}

/** Bind an action of the registry to its current combination. Silent inside text fields (lib/hotkeys.ts). */
export function useHotkey(action: HotkeyAction, handler: (e: KeyboardEvent) => void, { target = window, enabled = true, repeat = false, when }: Options = {}) {
  const combo = useHotkeyCombo(action)
  const ref = useRef({ handler, when })
  useEffect(() => {
    ref.current = { handler, when }
  })
  useEffect(() => {
    if (!target || !enabled || !combo) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !matches(e, combo) || (e.repeat && !repeat) || blockedByTyping(e, combo)) return
      if (ref.current.when && !ref.current.when(e)) return
      e.preventDefault()
      ref.current.handler(e)
    }
    target.addEventListener('keydown', onKey)
    return () => target.removeEventListener('keydown', onKey)
  }, [target, enabled, combo, repeat])
}
