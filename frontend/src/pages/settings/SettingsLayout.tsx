import { Bot, FolderTree, Languages, ScrollText, SlidersHorizontal } from 'lucide-react'
import { NavLink } from 'react-router'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { ActiveMark, RouteOutlet } from '@/components/motion'
import { PageHeader } from '@/components/ui'
import { SkeletonCard } from '@/components/skeleton'
import { cn } from '@/lib/cn'

export const SECTIONS = [
  { to: 'paths', icon: FolderTree, key: 'settings.paths' },
  { to: 'ai', icon: Bot, key: 'settings.ai' },
  { to: 'prompts', icon: ScrollText, key: 'settings.prompts' },
  { to: 'processing', icon: SlidersHorizontal, key: 'settings.processing' },
  { to: 'interface', icon: Languages, key: 'settings.interface' },
] as const

/**
 * The title stays put, the section list stays put (sticky), only the section content scrolls — with no visible bar.
 * The scroll container spans the full width so the wheel works anywhere on the page.
 */
export function SettingsLayout() {
  const { t, settings } = useUI()
  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto w-full max-w-4xl shrink-0 px-6 pt-8 lg:px-10">
        <PageHeader title={t('settings.title')} />
      </div>
      <div className="scroll-hidden min-h-0 flex-1">
        <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 pb-10 md:flex-row md:items-start lg:px-10">
          <nav className="scroll-hidden sticky top-0 z-10 -mx-6 flex shrink-0 gap-1 overflow-x-auto bg-bg px-6 pb-2 md:mx-0 md:w-44 md:flex-col md:overflow-visible md:px-0 md:pb-0">
            {SECTIONS.map((s) => (
              <NavLink
                key={s.to}
                to={s.to}
                className={({ isActive }) => cn('relative isolate flex h-8 shrink-0 items-center gap-2.5 rounded-lg px-3 text-[13px] whitespace-nowrap transition-colors', isActive ? 'text-fg' : 'text-muted hover:text-soft')}
              >
                {({ isActive }) => (
                  <>
                    {isActive && <ActiveMark layoutId="settings-nav" />}
                    <Icon as={s.icon} size={15} />
                    {t(s.key)}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="min-w-0 flex-1">{settings ? <RouteOutlet depth={2} /> : <div className="flex flex-col gap-4"><SkeletonCard /><SkeletonCard /></div>}</div>
        </div>
      </div>
    </div>
  )
}
