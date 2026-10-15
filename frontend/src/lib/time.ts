/** Mirrors backend/core/timeline.py — the clean timeline is the only one the UI seeks on. */

export function formatTc(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export function parseTc(value: string): number {
  const parts = value.replace(/[[\]]/g, '').split(':').map(Number)
  if (parts.some(Number.isNaN)) return 0
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

/** "[MM:SS]" or "[HH:MM:SS]", optionally wrapped in backticks by legacy audits. */
export const TIMECODE_RE = /`?\[(\d{1,2}:\d{2}(?::\d{2})?)\]`?/g
/** "[[lesson_id@MM:SS]]" citations from the notebook assistant. */
export const CITATION_RE = /\[\[([A-Za-z0-9_-]+)@(\d{1,2}:\d{2}(?::\d{2})?)\]\]/g

/** Index of the last item whose start <= t (binary search). */
export function findActiveIndex(starts: number[], t: number): number {
  let lo = 0
  let hi = starts.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (starts[mid] <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

/** Chapter markers from audit headings "### [MM:SS] Title". */
export function extractChapters(markdown: string): Array<{ t: number; title: string }> {
  const out: Array<{ t: number; title: string }> = []
  for (const line of markdown.split('\n')) {
    const m = /^#{2,4}\s+`?\[(\d{1,2}:\d{2}(?::\d{2})?)\]`?\s*(.*)$/.exec(line.trim())
    if (m) out.push({ t: parseTc(m[1]), title: m[2].replace(/[*_`]/g, '').trim() })
  }
  return out
}
