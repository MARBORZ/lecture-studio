import { useCallback, useRef } from 'react'
import { useFrameLoop } from '@/lib/motion'
import { LOOP_SEC, markSvg, STATIC_MARK, VIEWBOX } from './markGeometry'

/**
 * The animated Lecture Studio mark for the boot screen. No background: drawn in `currentColor`,
 * so it is white on the dark theme and black on the light one (inherits the text colour).
 * The first frame is the static logo — the same SVG index.html shows before any script runs,
 * so the hand-over has no seam. With "reduce motion" the mark stays static.
 */
export function BootMark({ size = 96, className }: { size?: number; className?: string }) {
  const ref = useRef<SVGSVGElement>(null)
  const draw = useCallback((sec: number) => {
    if (ref.current) ref.current.innerHTML = markSvg(sec % LOOP_SEC)
  }, [])
  useFrameLoop(draw)

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
