import { Clapperboard, Library, MonitorPlay, NotebookPen, PanelLeftClose, PanelLeftOpen, Plus, Settings, Unplug } from 'lucide-react'
import { createContext, useCallback, useContext, useState } from 'react'
import { NavLink } from 'react-router'
import { useJobs, useLibrary, useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { ActiveMark, m } from '@/components/motion'
import { IconButton } from '@/components/ui'
import { Skeleton } from '@/components/skeleton'
import { JobIndicator } from '@/features/jobs/JobIndicator'
import { ProjectFormModal } from '@/features/library/modals'
import { LESSON_DRAG, useMoveLesson } from '@/features/library/MoveLesson'
import { NotebookCover } from '@/features/library/NotebookCover'
import { FeedbackButton } from '@/features/feedback/Feedback'
import { ShutdownButton } from '@/features/system/ShutdownButton'
import { LogoMark } from '@/features/system/BootMark'
import { UpdateButton } from '@/features/system/Update'
import type { Project } from '@/api/types'
import { cn } from '@/lib/cn'
import { storage } from '@/lib/format'
import { ease } from '@/lib/motion'
import { useHotkey, useWithHotkey } from '@/features/hotkeys/useHotkey'

const COLLAPSED = 60
const EXPANDED = 256

/** Collapsed state for everything rendered inside the sidebar. */
const CollapsedContext = createContext(false)
export const useSidebarCollapsed = () => useContext(CollapsedContext)

function NavItem({ to, icon, children, end, count, notebook }: { to: string; icon?: typeof Library; children: string; end?: boolean; count?: number; notebook?: Project }) {
  const collapsed = useSidebarCollapsed()
  const move = useMoveLesson()
  const [over, setOver] = useState(false)
  // a notebook takes lesson rows dragged from the library
  const drop = notebook && {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(LESSON_DRAG)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setOver(true)
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      setOver(false)
      const id = e.dataTransfer.getData(LESSON_DRAG)
      if (!id) return
      e.preventDefault()
      void move(id, notebook.id)
    },
  }
  return (
    <NavLink
      to={to}
      end={end}
      title={over ? undefined : collapsed ? children : undefined}
      {...drop}
      className={({ isActive }) =>
        cn(
          'relative isolate flex h-8 shrink-0 items-center gap-2.5 rounded-lg px-[9px] text-[13px] transition-colors',
          isActive ? 'text-fg' : 'text-muted hover:bg-surface hover:text-soft',
          over && 'bg-surface text-fg ring-1 ring-fg',
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

  // ⌘B / Ctrl+B by default, anywhere (Settings → Hotkeys)
  useHotkey('sidebar.toggle', toggle)
  const toggleLabel = useWithHotkey('sidebar.toggle')(collapsed ? t('nav.expand') : t('nav.collapse'))

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
            <LogoMark className="size-[18px]" />
          </button>
          <span className={cn('flex-1 truncate text-[14px] font-semibold tracking-[-0.01em] whitespace-nowrap transition-opacity duration-200', collapsed && 'opacity-0')}>Lecture Studio</span>
          {!collapsed && <IconButton icon={PanelLeftClose} size="sm" label={toggleLabel} onClick={toggle} />}
        </div>

        <nav className="flex flex-col gap-0.5 px-3">
          <NavItem to="/library" icon={Library} end count={lessons.length}>{t('nav.library')}</NavItem>
          <NavItem to="/studio" icon={Clapperboard}>{t('nav.studio')}</NavItem>
          <NavItem to="/videos" icon={MonitorPlay}>{t('nav.videos')}</NavItem>
          <NavItem to="/diary" icon={NotebookPen}>{t('nav.diary')}</NavItem>
          <NavItem to="/settings" icon={Settings}>{t('nav.settings')}</NavItem>
        </nav>

        {/* collapsed: a hairline instead of the section label, and "new notebook" stays reachable */}
        <div className="relative mt-6 flex h-7 shrink-0 items-center justify-between pr-3 pl-[21px]">
          <span className={cn('label-caps whitespace-nowrap transition-opacity duration-200', collapsed && 'opacity-0')}>{t('nav.notebooks')}</span>
          <span className={cn('absolute top-1/2 left-[22px] h-px w-4 bg-line-strong transition-opacity duration-200', !collapsed && 'opacity-0')} />
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
          {collapsed && !loading && (
            <button
              type="button"
              title={t('nav.newNotebook')}
              aria-label={t('nav.newNotebook')}
              onClick={() => openModal((close) => <ProjectFormModal close={close} />)}
              className="flex h-8 shrink-0 items-center rounded-lg px-[9px] text-dim transition-colors hover:bg-surface hover:text-soft"
            >
              <span className="flex size-[18px] items-center justify-center rounded-[5px] border border-dashed border-line-strong">
                <Icon as={Plus} size={11} />
              </span>
            </button>
          )}
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
          <FeedbackButton />
          <ShutdownButton />
        </div>
      </m.aside>
    </CollapsedContext.Provider>
  )
}
