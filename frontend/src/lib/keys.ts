/** True when a key event comes from a text field (or rich editor): global hotkeys must not fire there. */
export function isTyping(e: Event, selector = 'input, textarea, select, [contenteditable]'): boolean {
  return e.target instanceof Element && Boolean(e.target.closest(selector))
}
