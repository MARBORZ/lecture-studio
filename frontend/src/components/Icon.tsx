import type { LucideIcon, LucideProps } from 'lucide-react'

/** Single icon wrapper: SVG only, inherits currentColor (white), consistent stroke. */
export function Icon({ as: Svg, size = 16, strokeWidth = 1.6, ...rest }: { as: LucideIcon } & LucideProps) {
  return <Svg size={size} strokeWidth={strokeWidth} aria-hidden {...rest} />
}
