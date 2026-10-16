import { useCallback, useRef } from 'react'
import { useFrameLoop } from '@/lib/motion'
import { LOOP_SEC, markSvg, STATIC_MARK, VIEWBOX } from './markGeometry'

/**
 * The animated Lecture Studio mark for the boot screen. No background: drawn in `currentColor`,
 * so it is white on the dark theme and black on the light one (inherits the text colour).
 * The first frame is the static logo — the same SVG index.html shows before any script runs,
 * so the hand-over has no seam. It loops even with the system's "reduce motion": the boot loop is the brand, a calm
 * 5 s cycle, and the owner wants it seen (decision 2026-10-16); the rest of the app still follows that setting.
 */
export function BootMark({ size = 96, className }: { size?: number; className?: string }) {
  const ref = useRef<SVGSVGElement>(null)
  const draw = useCallback((sec: number) => {
    if (ref.current) ref.current.innerHTML = markSvg(sec % LOOP_SEC)
  }, [])
  useFrameLoop(draw, { always: true })

  return (
    <svg
      ref={ref}
      viewBox={VIEWBOX}
      width={size}
      height={size}
      className={className}
      style={{ overflow: 'visible' }}
      role="img"
      aria-label="Lecture Studio"
      dangerouslySetInnerHTML={{ __html: STATIC_MARK }}
    />
  )
}

/** The static mark (frame 0 of the same geometry) for the sidebar and the tutorial. currentColor, no background. */
export function LogoMark({ className }: { className?: string }) {
  return <svg viewBox={VIEWBOX} className={className} style={{ overflow: 'visible' }} aria-hidden dangerouslySetInnerHTML={{ __html: STATIC_MARK }} />
}
