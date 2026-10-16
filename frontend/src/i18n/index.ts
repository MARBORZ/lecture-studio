import type { UILanguage } from '@/api/types'
import { en } from './en'
import { ru, type TKey } from './ru'

export type { TKey }
export type TFunction = (key: TKey, vars?: Record<string, string | number>) => string

const dictionaries: Record<UILanguage, Record<TKey, string>> = { ru, en }

let current: UILanguage = 'ru'

/** For code outside React (the API client, the router's error screen); AppProvider keeps it in step with settings. */
export function setLanguage(lang: UILanguage) {
  current = lang
}

export const tr: TFunction = (key, vars) => createT(current)(key, vars)

export function createT(lang: UILanguage): TFunction {
  const dict = dictionaries[lang] ?? ru
  return (key, vars) => {
    let s = dict[key] ?? ru[key] ?? key
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
    return s
  }
}
