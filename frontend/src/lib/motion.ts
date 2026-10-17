/**
 * The one animation config. Every motion in the app uses these curves, durations and presets,
 * so the whole UI moves the same way. Reduced-motion users get instant changes (MotionConfig in main.tsx).
 *
 * Performance rule: presets animate only `opacity` and a full `transform` string. Motion hands exactly those to the
 * browser (Web Animations API), so they run on the compositor at the display refresh rate even while React is busy
 * mounting the next screen. Independent x/y/scale would be driven from JS every frame on the main thread.
 * Exception: elements with `layout` (layout projection owns `transform`) use `fadeUpFlow` (y-based).
 */
import { useEffect } from 'react'
import type { Transition, Variants } from 'motion/react'

export const ease = [0.22, 1, 0.36, 1] as const // entering: fast start, soft landing (ease-out-quint)
export const easeIn = [0.55, 0, 0.75, 0.2] as const // leaving: gentle start, accelerates away
export const easeInOut = [0.65, 0, 0.35, 1] as const // scene changes

export const duration = { fast: 0.16, base: 0.26, slow: 0.42 } as const

/** Focus mode on a lesson: the player column widens and the player glides to the middle (and back), one scene change. */
export const focusShift: Transition = { duration: duration.slow, ease: easeInOut }

/** Markers, pops: settles quickly without wobble. */
export const spring: Transition = { type: 'spring', stiffness: 380, damping: 34, mass: 0.8 }
/**
 * Apple's system spring for sheets and pages (SwiftUI .smooth: response 0.5 s, damping fraction 1): critically
 * damped, so it glides in and settles without overshoot. From response / fraction with mass 1:
 * stiffness = (2π / response)², damping = 4π · fraction / response. Motion hands it to the browser as a linear()
 * easing, so it stays on the compositor like the tweens.
 */
export const springSheet: Transition = { type: 'spring', stiffness: 158, damping: 25, mass: 1 }
/** Celebratory pop (tutorial finale): Apple's .bouncy, the same response with damping fraction 0.7, one soft bounce. */
export const springBouncy: Transition = { type: 'spring', stiffness: 158, damping: 18, mass: 1 }

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

/** Cascade inside a scene: each child starts this long after the one before. */
export const stagger = 0.05

/** The leaving scene: shorter and quieter than the arrival, a small drift the other way. */
const stepOut = (dir: number = 1) => ({ opacity: 0, transform: tf(0, -4 * dir, 0.99), transition: leave })

/**
 * Tutorial scene (a step, the language and boot screens); custom = direction (1 forward, -1 back). It rises into place
 * on springSheet (y 8 → 0, scale 0.98 → 1) and its stepItem children follow in a cascade.
 */
export const stepIn: Variants = {
  hidden: (dir: number = 1) => ({ opacity: 0, transform: tf(0, 8 * dir, 0.98) }),
  show: { opacity: 1, ...rest, transition: { ...springSheet, staggerChildren: stagger } },
  exit: stepOut,
}

/**
 * A part of a stepIn scene: no initial / animate of its own, it takes the scene's and joins the cascade.
 * Nested parts cascade again inside it (the sketch beside the text).
 */
export const stepItem: Variants = {
  hidden: { opacity: 0, transform: tf(0, 6) },
  show: { opacity: 1, ...rest, transition: { ...springSheet, staggerChildren: stagger } },
}

/** A line drawing itself left to right (the intro's rule under the name); custom = delay. */
export const drawLine: Variants = {
  hidden: { transform: 'scaleX(0)' },
  show: (delay: number = 0) => ({ transform: 'scaleX(1)', transition: { duration: 0.8, ease, delay } }),
}

/** The finale: the badge pops in on springBouncy and its check draws; rings breathe out of it (custom = ring index). */
export const badgePop: Variants = {
  hidden: { opacity: 0, transform: 'scale(0.4)' },
  show: { opacity: 1, transform: 'scale(1)', transition: springBouncy },
}
export const drawCheck: Variants = {
  hidden: { pathLength: 0 },
  show: { pathLength: 1, transition: { duration: 0.55, ease, delay: 0.32 } },
}
export const ripple: Variants = {
  hidden: { opacity: 0, transform: 'scale(0.7)' },
  show: (i: number = 0) => ({
    opacity: [0, 0.32, 0],
    transform: ['scale(0.7)', 'scale(1.05)', 'scale(1.5)'],
    transition: { duration: 2.6, ease, delay: 0.7 + i * 0.85, repeat: Infinity },
  }),
}

/**
 * Tutorial -> app hand-off: the tutorial dissolves forward, then the app assembles (sidebar, then content).
 * No blur: a full-screen filter is repainted every frame and stutters on integrated GPUs.
 */
export const sceneOut: Variants = {
  show: { opacity: 1, ...rest },
  exit: { opacity: 0, transform: tf(0, 0, 1.03), transition: { duration: 0.42, ease: easeInOut } },
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

/** What focus mode hides (the lesson header, the blocks under the player): the same curve and time as focusShift,
 *  so the whole scene moves as one. */
/** What comes back when focus mode ends: a fade only (no height), so the layout settles in one step for the flip. */
export const focusFade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: duration.base, ease, delay: 0.12 } },
}

/**
 * Frame-by-frame drawing (the boot mark redraws its SVG every frame): `draw(seconds since start)` on every animation
 * frame while mounted. Not a transition, so not a Motion preset; it lives here so all motion stays in one layer.
 * Off when the system asks for reduced motion (the caller keeps showing its first frame), unless `always`.
 */
export function useFrameLoop(draw: (seconds: number) => void, { enabled = true, always = false } = {}): void {
  useEffect(() => {
    if (!enabled || (!always && matchMedia('(prefers-reduced-motion: reduce)').matches)) return
    let raf = 0
    const start = performance.now()
    const frame = (now: number) => {
      draw((now - start) / 1000)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [draw, enabled, always])
}

/**
 * FLIP: the element already sits at its new place and size (the layout changed in one step); it is moved back to
 * `from` with a transform and glides to the new box — one compositor animation, no layout work per frame, so a
 * video does not stutter. Uniform for a box that keeps its aspect (16:9 player). Runs whatever the OS motion setting,
 * like the focus scene it belongs to.
 */
export function flip(el: HTMLElement, from: DOMRect, ms = duration.slow * 1000): void {
  const to = el.getBoundingClientRect()
  if (!from.width || !to.width) return
  const s = from.width / to.width
  const dx = from.left - to.left
  const dy = from.top - to.top
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(s - 1) < 0.01) return
  el.animate(
    [
      { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${s})` },
      { transformOrigin: 'top left', transform: 'none' },
    ],
    { duration: ms, easing: `cubic-bezier(${easeInOut.join(',')})` },
  )
}
