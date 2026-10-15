const UNITS = {
  ru: { h: 'ч', m: 'мин', s: 'с', kb: 'КБ', mb: 'МБ', gb: 'ГБ' },
  en: { h: 'h', m: 'min', s: 's', kb: 'KB', mb: 'MB', gb: 'GB' },
} as const
const units = (lang: string) => UNITS[lang === 'en' ? 'en' : 'ru']

export function formatDuration(seconds: number, lang: string): string {
  const u = units(lang)
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h) return `${h} ${u.h} ${m} ${u.m}`
  if (m) return `${m} ${u.m}`
  return `${s} ${u.s}`
}

export function formatBytes(bytes: number, lang: string): string {
  const u = units(lang)
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} ${u.kb}`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} ${u.mb}`
  return `${(bytes / 1024 ** 3).toFixed(2)} ${u.gb}`
}

export function formatDateTime(iso: string, lang: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString(lang === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function formatDate(iso: string, lang: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? fallback : (JSON.parse(raw) as T)
    } catch {
      return fallback
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* private mode */
    }
  },
}
