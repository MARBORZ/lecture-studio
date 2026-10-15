import { Clapperboard, Library, NotebookPen, PanelLeftClose, PanelLeftOpen, Plus, Settings, Unplug } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { NavLink } from 'react-router'
import { useJobs, useLibrary, useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { ActiveMark, m } from '@/components/motion'
import { IconButton } from '@/components/ui'
import { Skeleton } from '@/components/skeleton'
import { JobIndicator } from '@/features/jobs/JobIndicator'
import { ProjectFormModal } from '@/features/library/modals'
import { NotebookCover } from '@/features/library/NotebookCover'
import { ShutdownButton } from '@/features/system/ShutdownButton'
import { UpdateButton } from '@/features/system/Update'
import type { Project } from '@/api/types'
import { cn } from '@/lib/cn'
import { storage } from '@/lib/format'
import { ease } from '@/lib/motion'
import { isHotkey, isTyping, shortcutLabel } from '@/lib/keys'

const COLLAPSED = 60
const EXPANDED = 256
export const SHORTCUT_LABEL = shortcutLabel('B')

/** Collapsed state for everything rendered inside the sidebar. */
const CollapsedContext = createContext(false)
export const useSidebarCollapsed = () => useContext(CollapsedContext)

function NavItem({ to, icon, children, end, count, notebook }: { to: string; icon?: typeof Library; children: string; end?: boolean; count?: number; notebook?: Project }) {
  const collapsed = useSidebarCollapsed()
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? children : undefined}
      className={({ isActive }) =>
        cn(
          'relative isolate flex h-8 shrink-0 items-center gap-2.5 rounded-lg px-[9px] text-[13px] transition-colors',
          isActive ? 'text-fg' : 'text-muted hover:bg-surface hover:text-soft',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <ActiveMark layoutId="sidebar-active" />}
          <span className="flex size-[18px] shrink-0 items-center justify-center">
            {icon ? (
              <Icon as={icon} size={15} />
            ) : notebook ? (
              <NotebookCover project={notebook} active={isActive} className="size-[18px] text-[10px]" />
            ) : null}
          </span>
          <span className={cn('min-w-0 flex-1 truncate whitespace-nowrap transition-opacity duration-200', collapsed && 'opacity-0')}>{children}</span>
          {count !== undefined && <span className={cn('font-mono text-[11px] text-dim transition-opacity duration-200', collapsed && 'opacity-0')}>{count}</span>}
        </>
      )}
    </NavLink>
  )
}

export function Sidebar() {
  const { t, openModal } = useUI()
  const { projects, lessons, loading } = useLibrary()
  const { connected } = useJobs()
  const [collapsed, setCollapsed] = useState(() => storage.get('sidebar.collapsed', false))

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      storage.set('sidebar.collapsed', !c)
      return !c
    })
  }, [])

  // ⌘B / Ctrl+B anywhere (ignored only inside rich-text editors).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isHotkey(e, 'KeyB', { mod: true }) && !isTyping(e, '[contenteditable]')) {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  const toggleLabel = `${collapsed ? t('nav.expand') : t('nav.collapse')} (${SHORTCUT_LABEL})`

  return (
    <CollapsedContext.Provider value={collapsed}>
      <m.aside
        initial={false}
        animate={{ width: collapsed ? COLLAPSED : EXPANDED }}
        transition={{ duration: 0.28, ease }}
        className="flex h-full shrink-0 flex-col overflow-hidden border-r border-line bg-bg"
      >
        <div className="flex h-14 shrink-0 items-center gap-2.5 pr-3 pl-[21px]">
          <button type="button" onClick={collapsed ? toggle : undefined} title={collapsed ? toggleLabel : undefined} className={cn('shrink-0', !collapsed && 'cursor-default')}>
            <svg viewBox="0 0 64 64" className="size-[18px]" aria-hidden>
              <path d="M18 16v32h28" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="square" />
              <path d="M30 24l14 8-14 8z" fill="currentColor" />
            </svg>
          </button>
          <span className={cn('flex-1 truncate text-[14px] font-semibold tracking-[-0.01em] whitespace-nowrap transition-opacity duration-200', collapsed && 'opacity-0')}>Lecture Studio</span>
          {!collapsed && <IconButton icon={PanelLeftClose} size="sm" label={toggleLabel} onClick={toggle} />}
        </div>

        <nav className="flex flex-col gap-0.5 px-3">
          <NavItem to="/library" icon={Library} end count={lessons.length}>{t('nav.library')}</NavItem>
          <NavItem to="/studio" icon={Clapperboard}>{t('nav.studio')}</NavItem>
          <NavItem to="/diary" icon={NotebookPen}>{t('nav.diary')}</NavItem>
          <NavItem to="/settings" icon={Settings}>{t('nav.settings')}</NavItem>
        </nav>

        <div className="mt-6 flex h-7 shrink-0 items-center justify-between pr-3 pl-[21px]">
          <span className={cn('label-caps whitespace-nowrap transition-opacity duration-200', collapsed && 'opacity-0')}>{t('nav.notebooks')}</span>
          {!collapsed && <IconButton icon={Plus} size="sm" label={t('nav.newNotebook')} onClick={() => openModal((close) => <ProjectFormModal close={close} />)} />}
        </div>
        <nav className="scroll-area flex min-h-0 flex-1 flex-col gap-0.5 px-3 pt-1">
          {loading
            ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="mx-2 my-2 h-3.5" />)
            : projects.map((p) => (
                <NavItem key={p.id} to={`/library/${p.id}`} count={p.lesson_count ?? 0} notebook={p}>
                  {p.name}
                </NavItem>
              ))}
        </nav>

        <JobIndicator />
        {!connected && (
          <div title={t('system.offline')} className="mx-3 mb-2 flex h-9 shrink-0 items-center gap-2.5 overflow-hidden rounded-lg border border-fg px-[9px] text-[12px] whitespace-nowrap text-fg">
            <Icon as={Unplug} size={15} className="shrink-0" />
            <span className={cn('transition-opacity duration-200', collapsed && 'opacity-0')}>{t('system.offline')}</span>
          </div>
        )}
        <div className="flex flex-col gap-0.5 border-t border-line p-3">
          {collapsed && <IconButton icon={PanelLeftOpen} label={toggleLabel} onClick={toggle} className="w-full" />}
          <UpdateButton />
          <ShutdownButton />
        </div>
      </m.aside>
    </CollapsedContext.Provider>
  )
}
