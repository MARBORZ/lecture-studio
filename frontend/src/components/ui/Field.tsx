import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { Search } from 'lucide-react'
import { Icon } from '@/components/Icon'
import { ActiveMark } from '@/components/motion'
import { cn } from '@/lib/cn'
import type { Option } from './Select'

const CONTROL =
  'w-full rounded-[var(--radius-ui)] border border-line bg-surface px-3 text-[13.5px] text-fg placeholder:text-dim transition-colors hover:border-line-strong focus:border-fg focus:outline-none disabled:opacity-50'

export function Field({ label, hint, error, children, className, aside }: { label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string; aside?: ReactNode }) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      {(label || aside) && (
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-[12.5px] font-medium text-soft">{label}</span>
          {aside && <span className="font-mono text-[12px] text-fg">{aside}</span>}
        </span>
      )}
      {children}
      {error ? <span className="text-[12px] text-fg">— {error}</span> : hint ? <span className="text-[12px] leading-snug text-muted">{hint}</span> : null}
    </label>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(CONTROL, 'h-9', className)} {...rest} />
})

/** A filter field: the magnifier inside, the rest of an Input. `sm` for toolbars inside a pane. */
export function SearchInput({ size = 'md', className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & { size?: 'sm' | 'md' }) {
  return (
    <div className={cn('relative', className)}>
      <Icon as={Search} size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-dim" />
      <Input className={cn('pl-8', size === 'sm' && 'h-8 text-[13px]')} {...rest} />
    </div>
  )
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(CONTROL, 'min-h-20 resize-y py-2 leading-relaxed', className)} {...rest} />
})


export { type Option, Select } from './Select'

export function Slider({ value, onChange, min, max, step = 1, format }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; format?: (v: number) => string }) {
  return (
    <div className="flex items-center gap-3">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-1 flex-1 cursor-pointer" />
      {format && <span className="w-16 text-right font-mono text-[12px] text-fg">{format(value)}</span>}
    </div>
  )
}

export function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group flex w-full items-start gap-3 text-left disabled:opacity-40"
    >
      <span className={cn('relative mt-0.5 h-[18px] w-8 shrink-0 rounded-full border transition-colors', checked ? 'border-fg bg-fg' : 'border-line-strong bg-transparent group-hover:border-muted')}>
        <span className={cn('absolute top-[2px] size-3 rounded-full transition-all', checked ? 'left-[16px] bg-bg' : 'left-[2px] bg-muted')} />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[13.5px] text-fg">{label}</span>
        {hint && <span className="text-[12px] leading-snug text-muted">{hint}</span>}
      </span>
    </button>
  )
}

/** Segmented control: pill group for 2–5 mutually exclusive values. */
export function Segmented<V extends string>({ options, value, onChange, size = 'md' }: { options: Option<V>[]; value: V; onChange: (v: V) => void; size?: 'sm' | 'md' }) {
  const id = useId()
  return (
    <div className={cn('inline-flex shrink-0 items-center rounded-[var(--radius-ui)] border border-line bg-surface p-[2px]', size === 'sm' ? 'h-7' : 'h-9')}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'relative isolate rounded-[6px] font-medium transition-colors duration-200',
            'h-full',
            size === 'sm' ? 'px-2.5 text-[12px]' : 'px-3 text-[12.5px]',
            value === o.value ? 'text-bg' : 'text-muted hover:text-fg',
          )}
        >
          {value === o.value && <ActiveMark layoutId={`segmented-${id}`} variant="solid" />}
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A consent or option checkbox with its text; the label wraps both, so the text toggles it too. */
export function Checkbox({ checked, onChange, children, className }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2.5 text-[13px] text-fg', className)}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-[3px] size-3.5 shrink-0 accent-fg" />
      <span className="leading-snug">{children}</span>
    </label>
  )
}
