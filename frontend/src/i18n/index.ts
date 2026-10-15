import type { UILanguage } from '@/api/types'
import { en } from './en'
import { ru, type TKey } from './ru'

export type { TKey }
export type TFunction = (key: TKey, vars?: Record<string, string | number>) => string

const dictionaries: Record<UILanguage, Record<TKey, string>> = { ru, en }

export function createT(lang: UILanguage): TFunction {
  const dict = dictionaries[lang] ?? ru
  return (key, vars) => {
    let s = dict[key] ?? ru[key] ?? key
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
    return s
  }
}
