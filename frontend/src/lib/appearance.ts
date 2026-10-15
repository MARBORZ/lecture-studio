/**
 * Theme and text size on <html>: data-theme="dark"|"light" and --text-scale.
 * "system" follows the OS live. The values are cached so index.html can apply them before the first paint.
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

export function useAppearance(theme: ThemeSetting | undefined, scale: number | undefined) {
  useEffect(() => {
    if (!theme) return
    const s = scale ?? 100
    apply(theme, s)
    storage.set('appearance', { theme, scale: s })
    if (theme !== 'system') return
    const mq = query()
    const onChange = () => apply(theme, s)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme, scale])
}

/** Live preview while a slider moves (the setting is saved on release). */
export function previewTextScale(scale: number) {
  document.documentElement.style.setProperty('--text-scale', String(scale / 100))
}
