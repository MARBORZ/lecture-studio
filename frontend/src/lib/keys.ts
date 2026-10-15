/** True when a key event comes from a text field (or rich editor): global hotkeys must not fire there. */
export function isTyping(e: Event, selector = 'input, textarea, select, [contenteditable]'): boolean {
  return e.target instanceof Element && Boolean(e.target.closest(selector))
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/** "⌘B" on macOS, "Ctrl+B" elsewhere. */
export const shortcutLabel = (letter: string) => (isMac ? `⌘${letter}` : `Ctrl+${letter}`)

/**
 * Hotkeys match the physical key (e.code, "KeyB"), never the typed character: with a Cyrillic layout Ctrl+B types "и"
 * on Windows, so comparing e.key with "b" never fires there. mod = ⌘ on macOS or Ctrl anywhere.
 */
export function isHotkey(e: KeyboardEvent, code: string, { mod = false } = {}): boolean {
  if (e.code !== code || e.shiftKey || e.altKey) return false
  return mod ? e.metaKey || e.ctrlKey : !e.metaKey && !e.ctrlKey
}
