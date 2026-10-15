import { cn } from '@/lib/cn'

/** Reusable loading placeholders. Compose these instead of ad-hoc shimmer divs. */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse-soft rounded-md bg-raised', className)} />
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3', i === lines - 1 ? 'w-3/5' : i % 2 ? 'w-11/12' : 'w-full')} />
      ))}
    </div>
  )
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-xl border border-line p-4', className)}>
      <Skeleton className="mb-3 h-4 w-2/5" />
      <SkeletonText lines={2} />
    </div>
  )
}

export function SkeletonList({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col divide-y divide-line rounded-xl border border-line', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <Skeleton className="size-2.5 rounded-full" />
          <Skeleton className="h-3.5 flex-1" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-10" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonPlayer({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <Skeleton className="aspect-video w-full rounded-xl" />
      <Skeleton className="h-1 w-full" />
      <div className="flex gap-2">
        <Skeleton className="size-9 rounded-lg" />
        <Skeleton className="h-9 w-24 rounded-lg" />
        <div className="flex-1" />
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>
    </div>
  )
}

export function SkeletonMarkdown({ className }: { className?: string }) {
  return (
    <div className={cn('flex max-w-[72ch] flex-col gap-6', className)}>
      <Skeleton className="h-7 w-3/5" />
      <SkeletonText lines={2} />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-3">
          <Skeleton className="h-4 w-2/5" />
          <SkeletonText lines={4} />
        </div>
      ))}
    </div>
  )
}

export function SkeletonChat({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2 rounded-xl border border-line p-4', className)}>
      <Skeleton className="h-3 w-24" />
      <SkeletonText lines={3} />
    </div>
  )
}
