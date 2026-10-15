import { useEffect, useState, type RefObject } from 'react'
import { useUI } from '@/app/AppProvider'
import { cn } from '@/lib/cn'

interface Item { id: string; text: string; level: number }

/** Table of contents built from rendered h2/h3 + scrollspy. */
export function Outline({ containerRef, deps }: { containerRef: RefObject<HTMLElement | null>; deps: unknown }) {
  const { t } = useUI()
  const [items, setItems] = useState<Item[]>([])
  const [active, setActive] = useState<string>()

  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    const headings = Array.from(root.querySelectorAll<HTMLElement>('h2[id], h3[id]'))
    setItems(headings.map((h) => ({ id: h.id, text: h.textContent?.trim() ?? '', level: h.tagName === 'H2' ? 2 : 3 })))
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { rootMargin: '0px 0px -70% 0px' },
    )
    headings.forEach((h) => observer.observe(h))
    return () => observer.disconnect()
  }, [containerRef, deps])

  if (items.length < 3) return null
  return (
    <nav className="flex flex-col gap-0.5 text-[12.5px]">
      <div className="label-caps mb-2">{t('lesson.outline')}</div>
      {items.map((i) => (
        <a
          key={i.id}
          href={`#${i.id}`}
          onClick={(e) => {
            e.preventDefault()
            document.getElementById(i.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
          className={cn(
            'truncate border-l py-1 transition-colors',
            i.level === 3 ? 'pl-5' : 'pl-3',
            active === i.id ? 'border-fg text-fg' : 'border-line text-muted hover:text-soft',
          )}
        >
          {i.text}
        </a>
      ))}
    </nav>
  )
}
