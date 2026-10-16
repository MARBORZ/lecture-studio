/**
 * The hotkey registry: every rebindable action, how a combination string matches a key event, how it reads.
 * Bindings come from the settings (Settings → Hotkeys); the rules (format, three keys, reserved, conflicts) live in
 * the backend (settings/hotkeys.py: the same ids, checked by tests/test_architecture.py). Components bind actions with
 * useHotkey (features/hotkeys/useHotkey.ts), never with their own key comparisons.
 *
 * A combination: modifiers in a fixed order, then the physical key (KeyboardEvent.code, so Ctrl+B also works with a
 * Cyrillic layout): "Mod+KeyB", "KeyF", "Ctrl+Mod+Digit5". Mod = ⌘ on macOS, Ctrl elsewhere.
 */
import { isMac, isTyping } from './keys'

export const HOTKEY_ACTIONS = ['sidebar.toggle', 'lesson.focus', 'player.toggle', 'player.back', 'player.forward', 'player.mark'] as const
export type HotkeyAction = (typeof HOTKEY_ACTIONS)[number]

const MODIFIERS = ['Mod', 'Ctrl', 'Meta', 'Alt', 'Shift'] as const
type Modifier = (typeof MODIFIERS)[number]
const MODIFIER_CODES = /^(Shift|Control|Alt|Meta|OS)(Left|Right)?$|^(CapsLock|Fn|FnLock)$/

export interface Combo {
  mods: Set<Modifier>
  code: string
}

export function parseCombo(combo: string): Combo | null {
  if (!combo) return null
  const parts = combo.split('+')
  const code = parts.pop()!
  if (!code || MODIFIERS.includes(code as Modifier) || parts.some((p) => !MODIFIERS.includes(p as Modifier))) return null
  return { mods: new Set(parts as Modifier[]), code }
}

/** The physical modifier keys a combination needs on this platform. */
function needs({ mods }: Combo) {
  const cmd = mods.has('Mod')
  return {
    meta: mods.has('Meta') || (isMac && cmd),
    ctrl: mods.has('Ctrl') || (!isMac && cmd),
    alt: mods.has('Alt'),
    shift: mods.has('Shift'),
  }
}

/** Exactly this combination (no extra modifiers), by the physical key. */
export function matches(e: KeyboardEvent, combo: string): boolean {
  const c = parseCombo(combo)
  if (!c || e.code !== c.code) return false
  const n = needs(c)
  return e.metaKey === n.meta && e.ctrlKey === n.ctrl && e.altKey === n.alt && e.shiftKey === n.shift
}

/**
 * Where a combination must stay quiet: one without ⌘/Ctrl is typing inside any text field; one with them works in
 * fields (like ⌘B always did) but not inside rich editors, which use them for formatting.
 */
export function blockedByTyping(e: KeyboardEvent, combo: string): boolean {
  const c = parseCombo(combo)
  const n = c && needs(c)
  return n && (n.meta || n.ctrl) ? isTyping(e, '[contenteditable]') : isTyping(e)
}

/** The combination being pressed, or null while only modifiers are down. */
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (!e.code || MODIFIER_CODES.test(e.code)) return null
  const mods = new Set<Modifier>()
  if (e.metaKey) mods.add(isMac ? 'Mod' : 'Meta')
  if (e.ctrlKey) mods.add(isMac ? 'Ctrl' : 'Mod')
  if (e.altKey) mods.add('Alt')
  if (e.shiftKey) mods.add('Shift')
  return [...MODIFIERS.filter((m) => mods.has(m)), e.code].join('+')
}

/** Modifiers held right now, as they read (the recorder shows them before the key comes). */
export function heldLabel(e: KeyboardEvent): string {
  const mods = new Set<Modifier>()
  if (e.metaKey) mods.add(isMac ? 'Mod' : 'Meta')
  if (e.ctrlKey) mods.add(isMac ? 'Ctrl' : 'Mod')
  if (e.altKey) mods.add('Alt')
  if (e.shiftKey) mods.add('Shift')
  return modLabels(mods).join(isMac ? '' : '+')
}

const KEY_NAMES: Record<string, string> = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`', PageUp: 'PgUp', PageDown: 'PgDn',
}

function keyName(code: string, space: string): string {
  if (code === 'Space') return space
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`
  return KEY_NAMES[code] ?? code
}

function modLabels(mods: Set<Modifier>): string[] {
  // macOS reads ⌃⌥⇧⌘; Windows Ctrl+Alt+Shift+Win
  if (isMac) {
    return [mods.has('Ctrl') && '⌃', mods.has('Alt') && '⌥', mods.has('Shift') && '⇧', (mods.has('Mod') || mods.has('Meta')) && '⌘'].filter(Boolean) as string[]
  }
  return [(mods.has('Mod') || mods.has('Ctrl')) && 'Ctrl', mods.has('Alt') && 'Alt', mods.has('Shift') && 'Shift', mods.has('Meta') && 'Win'].filter(Boolean) as string[]
}

/** "⌃⌘5" on a Mac, "Ctrl+Alt+5" on Windows; "" for no combination. `space`: the name of the space bar. */
export function comboLabel(combo: string, space = 'Space'): string {
  const c = parseCombo(combo)
  if (!c) return ''
  const parts = [...modLabels(c.mods), keyName(c.code, space)]
  return isMac ? parts.join('') : parts.join('+')
}
