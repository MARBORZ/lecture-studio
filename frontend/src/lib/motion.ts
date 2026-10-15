/**
 * The one animation config. Every motion in the app uses these curves, durations and presets,
 * so the whole UI moves the same way. Reduced-motion users get instant changes (MotionConfig in main.tsx).
 *
 * Performance rule: presets animate only `opacity` and a full `transform` string. Motion hands exactly those to the
 * browser (Web Animations API), so they run on the compositor at the display refresh rate even while React is busy
 * mounting the next screen. Independent x/y/scale would be driven from JS every frame on the main thread.
 * Exception: elements with `layout` (layout projection owns `transform`) use `fadeUpFlow` (y-based).
 */
import type { Transition, Variants } from 'motion/react'

export const ease = [0.22, 1, 0.36, 1] as const // entering: fast start, soft landing (ease-out-quint)
export const easeIn = [0.55, 0, 0.75, 0.2] as const // leaving: gentle start, accelerates away
export const easeInOut = [0.65, 0, 0.35, 1] as const // scene changes

export const duration = { fast: 0.16, base: 0.26, slow: 0.42 } as const

/** Markers, pops: settles quickly without wobble. */
export const spring: Transition = { type: 'spring', stiffness: 380, damping: 34, mass: 0.8 }
/** Celebratory pop (tutorial finale). */
export const springBouncy: Transition = { type: 'spring', stiffness: 260, damping: 16, mass: 0.9 }

const leave = { duration: duration.fast, ease: easeIn }

export const base: Transition = { duration: duration.base, ease }

/** translate3d + scale as one transform string (compositor-friendly). */
const tf = (x = 0, y = 0, scale = 1) => `translate3d(${x}px, ${y}px, 0px) scale(${scale})`
/**
 * Resting state: animate to the identity transform, then drop it. Animating *to* `none` is not interpolated —
 * the element froze at its start offset (pages sat 12px low, cutting off their bottom edge). `none` at rest also keeps
 * no stacking context / containing block around the content.
 */
const rest = { transform: tf(), transitionEnd: { transform: 'none' } }

/** Content appearing: cards, pages, text. custom = delay in seconds. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, transform: tf(0, 6) },
  show: (delay: number = 0) => ({ opacity: 1, ...rest, transition: { ...base, delay } }),
  exit: { opacity: 0, transform: tf(0, -3), transition: leave },
}

/** Opacity only: children inside something that already moves (no double motion). custom = delay. */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: (delay: number = 0) => ({ opacity: 1, transition: { duration: duration.base, ease, delay } }),
  exit: { opacity: 0, transition: leave },
}

/** Same motion for elements with `layout` (lists that reflow): y-based so layout projection can compose it. */
export const fadeUpFlow: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: (delay: number = 0) => ({ opacity: 1, y: 0, transition: { ...base, delay } }),
  exit: { opacity: 0, y: -3, transition: leave },
}

/** Dialog panel. */
export const pop: Variants = {
  hidden: { opacity: 0, transform: tf(0, 6, 0.97) },
  show: { opacity: 1, ...rest, transition: spring },
  exit: { opacity: 0, transform: tf(0, 4, 0.98), transition: leave },
}

/** Backdrops, overlays. */
export const fade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: duration.base, ease } },
  exit: { opacity: 0, transition: leave },
}

/** Horizontal step change; custom = direction (1 forward, -1 back). */
export const slide: Variants = {
  hidden: (dir: number) => ({ opacity: 0, transform: tf(28 * dir) }),
  show: { opacity: 1, ...rest, transition: { duration: duration.slow, ease } },
  exit: (dir: number) => ({ opacity: 0, transform: tf(-14 * dir), transition: leave }),
}

/** Tutorial -> app hand-off: the tutorial dissolves forward, then the app assembles (sidebar, then content). */
export const sceneOut: Variants = {
  show: { opacity: 1, ...rest, filter: 'blur(0px)' },
  exit: { opacity: 0, transform: tf(0, 0, 1.03), filter: 'blur(6px)', transition: { duration: 0.42, ease: easeInOut } },
}
export const sidebarIn: Variants = {
  hidden: { opacity: 0, transform: tf(-16) },
  show: { opacity: 1, ...rest, transition: { duration: 0.5, ease, delay: 0.05 } },
}
export const contentIn: Variants = {
  hidden: { opacity: 0, transform: tf(0, 12) },
  show: { opacity: 1, ...rest, transition: { duration: 0.55, ease, delay: 0.16 } },
}

/** Stagger by list index, capped: the 9th item and later appear together, long lists never crawl. */
export function itemDelay(index: number, each = 0.035, cap = 8): number {
  return Math.min(index, cap) * each
}

/** Height open/close for collapsibles. */
export const collapse: Variants = {
  hidden: { height: 0, opacity: 0 },
  show: { height: 'auto', opacity: 1, transition: { duration: duration.base, ease } },
  exit: { height: 0, opacity: 0, transition: leave },
}
