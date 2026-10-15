import { Bot, FolderTree, Languages, ScrollText, SlidersHorizontal } from 'lucide-react'
import { NavLink } from 'react-router'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { ActiveMark, RouteOutlet } from '@/components/motion'
import { Page, PageHeader } from '@/components/ui'
import { SkeletonCard } from '@/components/skeleton'
import { cn } from '@/lib/cn'

export const SECTIONS = [
  { to: 'paths', icon: FolderTree, key: 'settings.paths' },
  { to: 'ai', icon: Bot, key: 'settings.ai' },
  { to: 'prompts', icon: ScrollText, key: 'settings.prompts' },
  { to: 'processing', icon: SlidersHorizontal, key: 'settings.processing' },
  { to: 'interface', icon: Languages, key: 'settings.interface' },
] as const

export function SettingsLayout() {
  const { t, settings } = useUI()
  return (
    <Page>
      <PageHeader title={t('settings.title')} />
      <div className="flex flex-col gap-6 md:flex-row">
        <nav className="flex shrink-0 gap-1 md:w-44 md:flex-col">
          {SECTIONS.map((s) => (
            <NavLink
              key={s.to}
              to={s.to}
              className={({ isActive }) => cn('relative isolate flex h-8 items-center gap-2.5 rounded-lg px-3 text-[13px] transition-colors', isActive ? 'text-fg' : 'text-muted hover:text-soft')}
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
    </Page>
  )
}
