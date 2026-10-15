import type { LucideIcon } from 'lucide-react'
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
/** Control height scale shared by Button, IconButton, Input and Segmented: sm 28 · md 36 · lg 40. */
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-fg text-bg hover:bg-soft border border-fg',
  secondary: 'bg-transparent text-fg border border-line-strong hover:border-fg hover:bg-hover',
  ghost: 'bg-transparent text-soft border border-transparent hover:text-fg hover:bg-hover',
  danger: 'bg-transparent text-fg border border-fg hover:bg-fg hover:text-bg',
}
const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[12.5px] gap-1.5',
  md: 'h-9 px-3.5 text-[13.5px] gap-2',
  lg: 'h-10 px-4 text-[14px] gap-2',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: LucideIcon
  iconRight?: LucideIcon
  loading?: boolean
  children?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconRight, loading, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[var(--radius-ui)] font-medium whitespace-nowrap transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.97]',
        'disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {icon && <Icon as={icon} size={size === 'sm' ? 14 : 16} className={loading ? 'animate-pulse-soft' : undefined} />}
      {children}
      {iconRight && <Icon as={iconRight} size={size === 'sm' ? 14 : 16} />}
    </button>
  )
})

export function IconButton({ icon, label, size = 'md', active, className, ...rest }: Omit<ButtonProps, 'children' | 'icon'> & { icon: LucideIcon; label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[var(--radius-ui)] text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-40',
        size === 'sm' ? 'size-7' : 'size-9',
        active && 'bg-hover text-fg',
        className,
      )}
      {...rest}
    >
      <Icon as={icon} size={size === 'sm' ? 15 : 17} />
    </button>
  )
}
