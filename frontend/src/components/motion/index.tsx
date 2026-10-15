/**
 * Motion building blocks. Screens use these instead of raw motion props, so animation stays consistent and DRY.
 */
import { AnimatePresence, m, type HTMLMotionProps } from 'motion/react'
import { useLocation, useOutlet } from 'react-router'
import { fadeUp, fadeUpFlow, itemDelay, spring } from '@/lib/motion'

export { AnimatePresence, m }

/** Fade-up on mount (and on key change). */
export function Appear({ delay = 0, ...props }: HTMLMotionProps<'div'> & { delay?: number }) {
  return <m.div variants={fadeUp} initial="hidden" animate="show" exit="exit" custom={delay} {...props} />
}

/** List item: staggered fade-up by index; layout-animates when siblings come and go (wrap list in AnimatePresence). */
export function ListItem({ index = 0, ...props }: HTMLMotionProps<'div'> & { index?: number }) {
  return (
    <m.div
      layout="position"
      variants={fadeUpFlow}
      initial="hidden"
      animate="show"
      exit="exit"
      custom={itemDelay(index)}
      {...props}
    />
  )
}

/**
 * Route outlet that fades the new screen in. `depth` = which URL segment defines "a different screen"
 * (1 for top-level pages, 3 for lesson tabs, …), so nested navigation does not re-animate the parent.
 */
export function RouteOutlet({ depth = 1, className, context }: { depth?: number; className?: string; context?: unknown }) {
  const outlet = useOutlet(context)
  const key = useLocation().pathname.split('/').slice(1, depth + 1).join('/')
  return (
    <m.div key={key} variants={fadeUp} initial="hidden" animate="show" className={className}>
      {outlet}
    </m.div>
  )
}

/**
 * The sliding "you are here" marker. Same layoutId within one navigation = it glides between items.
 *   pill      — soft background (sidebar, settings nav, tutorial rail, diary categories)
 *   solid     — white pill under black text (segmented controls)
 *   underline — 1px line at the bottom (tabs)
 * Parent must be `relative isolate`.
 */
export function ActiveMark({ layoutId, variant = 'pill' }: { layoutId: string; variant?: 'pill' | 'solid' | 'underline' }) {
  const cls = {
    pill: 'absolute inset-0 -z-10 rounded-lg bg-raised',
    solid: 'absolute inset-0 -z-10 rounded-[6px] bg-fg',
    underline: 'absolute inset-x-0 -bottom-px h-px bg-fg',
  }[variant]
  return <m.span layoutId={layoutId} transition={spring} className={cls} aria-hidden />
}
