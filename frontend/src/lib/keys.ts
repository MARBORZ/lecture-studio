/** True when a key event comes from a text field (or rich editor): global hotkeys must not fire there. */
export function isTyping(e: Event, selector = 'input, textarea, select, [contenteditable]'): boolean {
  return e.target instanceof Element && Boolean(e.target.closest(selector))
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/** A fixed system combination as text, "⌘V" on macOS, "Ctrl+V" elsewhere (paste; app hotkeys read from lib/hotkeys.ts). */
export const shortcutLabel = (letter: string) => (isMac ? `⌘${letter}` : `Ctrl+${letter}`)
