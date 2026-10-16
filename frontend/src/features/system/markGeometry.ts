/**
 * (From the B3 archive as bootMark.ts; renamed: next to BootMark.tsx the two names clash on case-insensitive disks.)
 *
 * Lecture Studio mark «B3 — Звук над результатом»: geometry and the 5 s boot loop.
 *
 * Pure functions, no DOM: `markSvg(t)` returns the inner SVG (viewBox "224 224 576 576") for loop time t in seconds.
 * Everything is drawn with `currentColor`, so the mark follows the theme by itself:
 * white on the dark theme, black on the light one (set `color` on the <svg> or a parent).
 *
 * The loop is the path a lecture takes through the studio, in one rhythm (every stage is the same spring):
 *   0.0 s  divide  — the cut opens, columns split and drift apart
 *   0.8 s  wave    — the columns become a live waveform
 *   1.8 s  realign — the wave is corrected back into the play shape
 *   2.6 s  join    — the horizontal cut closes
 *   3.15 s solid   — the columns lock into one solid play, a soft punch
 *   4.1 s  return  — back to the base (frame 0) and the loop starts again
 * Frame 0 is the static logo; frame 5.0 equals frame 0 exactly.
 */

export const LOOP_SEC = 5
export const VIEWBOX = '224 224 576 576'

type Col = { g: number; dxT: number; dxB: number; cT: number; cB: number; wvT: number; wvB: number; hwT: number; hwB: number; sx: number; dy: number }
type ColIn = Partial<Col> & { c?: number; wv?: number; hw?: number }
type Half = 'T' | 'B'

const KEYS: (keyof Col)[] = ['g', 'dxT', 'dxB', 'cT', 'cB', 'wvT', 'wvB', 'hwT', 'hwB', 'sx', 'dy']
const clamp = (v: number) => Math.min(Math.max(v, 0), 1)
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const f = (n: number) => n.toFixed(2)

/** Damped spring: 0 before `a`, settles to 1 inside `dur` (slight overshoot when zeta < 1). */
function spr(t: number, a: number, dur: number, zeta: number): number {
  const x = t - a
  if (x <= 0) return 0
  if (x >= dur) return 1
  const w = 7 / (zeta * dur)
  const wd = w * Math.sqrt(1 - zeta * zeta)
  return 1 - Math.exp(-zeta * w * x) * (Math.cos(wd * x) + ((zeta * w) / wd) * Math.sin(wd * x))
}

const SP = { dur: 0.65, z: 0.6, st: 0.035 } // one spring for every stage; column stagger
const T = { divide: 0, waveIn: 0.8, waveOut: 1.8, join: 2.6, solid: 3.15, punch: 3.45, ret: 4.1 }
const beat = (t: number, a: number, i = 0) => spr(t, a + i * SP.st, SP.dur, SP.z)

// The play, optically centred in the 1024 grid: bbox centre 8% of its width right of the centre.
const H = 470
const W = H * 0.87
const X0 = 512 + 0.08 * W - W / 2
const X1 = X0 + W
const envTop = (x: number) => 512 - (H / 2) * (1 - clamp((x - X0) / W))
const WAVE = [0.8, 1.0, 0.58, 0.92, 0.5, 0.74, 0.4]

const norm = (s: ColIn): Col => {
  const o = {} as Col
  for (const k of KEYS) o[k] = s[k] ?? 0
  if (s.c != null) o.cT = o.cB = s.c
  if (s.wv != null) o.wvT = o.wvB = s.wv
  if (s.hw != null) o.hwT = o.hwB = s.hw
  return o
}
const mix = (a: Col, b: Col, k: number): Col => {
  const o = {} as Col
  for (const key of KEYS) o[key] = lerp(a[key], b[key], k)
  return o
}

/** The base: the top half is still a wave, the bottom half is already the solid play; cut and shifted. */
const BASE: Col[] = [0.92, 0.62, 0.8, 0.5, 0.66, 0.38, 0.22].map((v) => norm({ g: 26, cT: 18, wvT: 1, hwT: (H * v) / 2, dxT: 18, dxB: -18 }))

const punchAt = (t: number) => {
  const x = t - T.punch
  return x > 0 && x < 0.4 ? 1 + 0.05 * Math.exp(-8 * x) * Math.sin((2 * Math.PI * x) / 0.3) * (1 - x / 0.4) : 1
}

function draw(cols: Col[], t: number): string {
  const N = cols.length
  const slot = W / N
  const c0 = cols[0]
  const solid = cols.every(
    (c) => c.cT < 1.5 && c.cB < 1.5 && c.wvT < 0.01 && c.wvB < 0.01 && Math.abs(c.sx) < 0.8 && Math.abs(c.dy) < 0.8
      && Math.abs(c.g - c0.g) < 0.3 && Math.abs(c.dxT - c0.dxT) < 0.3 && Math.abs(c.dxB - c0.dxB) < 0.3,
  )
  let s = ''
  if (solid) {
    const gg = Math.max(c0.g, 0)
    const xm = X0 + W * (1 - gg / H)
    s += `<path transform="translate(${f(c0.dxT)} 0)" d="M${f(X0)} ${f(512 - gg / 2)}L${f(X0)} ${f(512 - H / 2)}L${f(xm)} ${f(512 - gg / 2)}z" fill="currentColor"/>`
    s += `<path transform="translate(${f(c0.dxB)} 0)" d="M${f(X0)} ${f(512 + gg / 2)}L${f(X0)} ${f(512 + H / 2)}L${f(xm)} ${f(512 + gg / 2)}z" fill="currentColor"/>`
  } else {
    // per half: neighbouring closed columns that move together are drawn as ONE quad (no anti-aliasing seams)
    for (const half of ['T', 'B'] as Half[]) {
      type Run = { a0: number; b0: number; yA: number; yB: number; closed: boolean; key: string; c: Col }
      const runs: Run[] = []
      cols.forEach((c, i) => {
        const cc = Math.max(0, c[`c${half}`])
        const wv = clamp(c[`wv${half}`])
        const a0 = X0 + i * slot + cc / 2
        const b0 = Math.min(X0 + (i + 1) * slot - cc / 2, X1)
        const yA = lerp(envTop(a0) - 512, -c[`hw${half}`], wv)
        const yB = lerp(envTop(b0) - 512, -c[`hw${half}`], wv)
        const seg: Run = { a0, b0, yA, yB, closed: cc < 1.5 && wv < 0.01, key: [c.sx, c.dy, c[`dx${half}`], c.g].map((v) => v.toFixed(1)).join(), c }
        const r = runs[runs.length - 1]
        if (r && r.closed && seg.closed && r.key === seg.key) {
          r.b0 = seg.b0
          r.yB = seg.yB
        } else runs.push(seg)
      })
      for (const r of runs) {
        if (r.b0 - r.a0 < 0.3) continue
        const c = r.c
        const gg = Math.max(c.g, 0)
        const cy = 512 + c.dy
        const a = r.a0 + c.sx + c[`dx${half}`]
        const b = r.b0 + c.sx + c[`dx${half}`]
        // edge from (a, yA) to (b, yB) is clipped by the cut line; where it crosses the line the polygon gets a vertex there,
        // so the diagonal keeps its true angle all the way to the cut (no slope jump when columns merge or split)
        const lim = half === 'T' ? -gg / 2 : gg / 2
        const ya = half === 'T' ? r.yA : -r.yA
        const yb = half === 'T' ? r.yB : -r.yB
        const out = (y: number) => (half === 'T' ? y < lim - 0.4 : y > lim + 0.4)
        if (!out(ya) && !out(yb)) continue
        const pts: [number, number][] = [[a, lim]]
        if (out(ya) && out(yb)) pts.push([a, ya], [b, yb], [b, lim])
        else if (out(ya)) pts.push([a, ya], [a + ((lim - ya) / (yb - ya)) * (b - a), lim])
        else pts.push([a + ((lim - ya) / (yb - ya)) * (b - a), lim], [b, yb], [b, lim])
        s += `<path d="M${pts.map(([x, y]) => `${f(x)} ${f(cy + y)}`).join('L')}z" fill="currentColor"/>`
      }
    }
  }
  return `<g transform="translate(512 512) scale(${punchAt(t).toFixed(4)}) translate(-512 -512)">${s}</g>`
}

/** Inner SVG of the mark at loop time t (seconds, wrapped to the loop). t = 0 is the static logo. */
export function markSvg(t: number): string {
  t = ((t % LOOP_SEC) + LOOP_SEC) % LOOP_SEC
  const N = BASE.length
  const mid = (N - 1) / 2
  const out = BASE.map((b, i) => {
    const from = Math.abs(i - mid)
    const noise = 0.22 * Math.sin(t * 10.7 + i * 1.31) * Math.cos(t * 4.9 + i * 2.17)
    const hw = (H * Math.max(0.1, WAVE[i] + noise)) / 2
    const DIV = norm({ g: 64, dxT: 30, dxB: -30, c: 22, sx: (i - mid) * 9 })
    const WAV = norm({ g: 22, c: 22, wv: 1, hw, sx: (i - mid) * 5 })
    const REAL = norm({ g: 22, c: 22 })
    const JOIN = norm({ g: 0, c: 22 })
    const SOLID = norm({})
    let v = mix(b, DIV, beat(t, T.divide, from))
    v = mix(v, WAV, beat(t, T.waveIn, i))
    v = mix(v, REAL, beat(t, T.waveOut, i))
    v = mix(v, JOIN, beat(t, T.join, 0))
    v = mix(v, SOLID, beat(t, T.solid, N - 1 - i))
    v = mix(v, b, beat(t, T.ret, i))
    return v
  })
  return draw(out, t)
}

/** The static logo (frame 0). */
export const STATIC_MARK = markSvg(0)
