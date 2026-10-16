/**
 * Theme and text size on <html>: data-theme="dark"|"light" and --text-scale.
 * "system" follows the OS live. The values are cached so index.html can apply them before the first paint,
 * together with the boot animation switch, which the boot screen needs before the settings arrive.
 */
import { useEffect } from 'react'
import type { SettingsView } from '@/api/types'
import { storage } from './format'

export type ThemeSetting = SettingsView['theme']

const query = () => window.matchMedia('(prefers-color-scheme: dark)')

function apply(theme: ThemeSetting, scale: number) {
  const dark = theme === 'dark' || (theme === 'system' && query().matches)
  const root = document.documentElement
  root.dataset.theme = dark ? 'dark' : 'light'
  root.style.setProperty('--text-scale', String(scale / 100))
}

interface Cached {
  theme?: ThemeSetting
  scale?: number
  boot?: boolean
}

/** The boot animation switch as last saved (on when nothing is cached yet). */
export function bootAnimationCached(): boolean {
  return storage.get<Cached>('appearance', {}).boot !== false
}

export function useAppearance(theme: ThemeSetting | undefined, scale: number | undefined, boot: boolean | undefined) {
  useEffect(() => {
    if (!theme) return
    const s = scale ?? 100
    apply(theme, s)
    storage.set('appearance', { theme, scale: s, boot: boot ?? true } satisfies Cached)
    if (theme !== 'system') return
    const mq = query()
    const onChange = () => apply(theme, s)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme, scale, boot])
}

/** Live preview while a slider moves (the setting is saved on release). */
export function previewTextScale(scale: number) {
  document.documentElement.style.setProperty('--text-scale', String(scale / 100))
}
