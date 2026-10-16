/**
 * The one provider of the app. Internally split into three contexts so that fast-changing
 * job progress does not re-render library views; consumers use the typed hooks below.
 *
 *   useUI()      — settings, language/t(), modals, confirm(), promptText(), toasts, stopped state, tutorial replay
 *   useLibrary() — projects, lessons, refresh, mutations
 *   useJobs()    — live job list (SSE), in-tab uploads
 *
 * The media player lives outside React state (features/player/store.ts).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '@/api/client'
import type { Job, Lesson, LessonPatch, Project, ProjectCreate, ProjectPatch, SettingsPatch, SettingsView, UILanguage } from '@/api/types'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { PromptDialog } from '@/components/ui/PromptDialog'
import { createT, setLanguage, type TFunction } from '@/i18n'
import { useAppearance } from '@/lib/appearance'
import { storage } from '@/lib/format'

const INBOX_ID = 'proj_inbox' // backend/models/project.py
const LANG_KEY = 'ui.lang'

// ---------------------------------------------------------------- UI

export type ToastKind = 'info' | 'error'
interface Toast { id: number; kind: ToastKind; text: string }

type ModalRender = (close: () => void) => ReactNode
interface ModalEntry { id: number; render: () => ReactNode }

export interface ConfirmOptions {
  title: string
  text?: ReactNode
  confirmLabel?: string
  danger?: boolean
}

export interface PromptOptions {
  title: string
  label?: string
  initial?: string
  confirmLabel?: string
  maxLength?: number
}

interface UIContextValue {
  settings: SettingsView | undefined
  reloadSettings: () => Promise<void>
  patchSettings: (patch: SettingsPatch) => Promise<SettingsView>
  replaceSettings: (s: SettingsView) => void
  lang: UILanguage
  t: TFunction
  openModal: (render: ModalRender) => () => void
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  promptText: (opts: PromptOptions) => Promise<string | null>
  toast: (text: string, kind?: ToastKind) => void
  modals: ModalEntry[]
  toasts: Toast[]
  dismissToast: (id: number) => void
  stopped: boolean
  setStopped: (v: boolean) => void
  tutorialOpen: boolean
  setTutorialOpen: (v: boolean) => void
  focusMode: boolean
  setFocusMode: (v: boolean | ((prev: boolean) => boolean)) => void
}

// ---------------------------------------------------------------- Library

interface LibraryContextValue {
  projects: Project[]
  lessons: Lesson[]
  loading: boolean
  refresh: () => Promise<void>
  createProject: (data: ProjectCreate) => Promise<Project>
  patchProject: (id: string, patch: ProjectPatch) => Promise<void>
  /** file = new image, null = remove */
  setProjectCover: (id: string, file: File | null) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  patchLesson: (id: string, patch: LessonPatch) => Promise<Lesson>
  deleteLesson: (id: string) => Promise<void>
  projectName: (id: string) => string
}

// ---------------------------------------------------------------- Jobs

export interface LocalUpload { id: number; name: string; progress: number }

interface JobsContextValue {
  jobs: Job[]
  activeJobs: Job[]
  connected: boolean
  uploads: LocalUpload[]
  trackUpload: (name: string) => { progress: (f: number) => void; done: () => void }
}

const UIContext = createContext<UIContextValue | null>(null)
const LibraryContext = createContext<LibraryContextValue | null>(null)
const JobsContext = createContext<JobsContextValue | null>(null)

function must<T>(v: T | null, name: string): T {
  if (!v) throw new Error(`${name} must be used inside <AppProvider>`)
  return v
}

export const useUI = () => must(useContext(UIContext), 'useUI')
export const useLibrary = () => must(useContext(LibraryContext), 'useLibrary')
export const useJobs = () => must(useContext(JobsContext), 'useJobs')

let seq = 0

export function AppProvider({ children }: { children: ReactNode }) {
  // ---------- settings / i18n ----------
  const [settings, setSettings] = useState<SettingsView>()
  const reloadSettings = useCallback(async () => setSettings(await api.settings()), [])
  const patchSettings = useCallback(async (patch: SettingsPatch) => {
    const next = await api.patchSettings(patch)
    setSettings(next)
    return next
  }, [])
  // Until settings arrive (the boot screen), the language of the last visit.
  const lang: UILanguage = settings?.ui_language ?? storage.get<UILanguage>(LANG_KEY, 'ru')
  const t = useMemo(() => createT(lang), [lang])
  useAppearance(settings?.theme, settings?.text_scale, settings?.boot_animation)
  useEffect(() => {
    document.documentElement.lang = lang
    setLanguage(lang)
    if (settings) storage.set(LANG_KEY, lang)
  }, [lang, settings])

  // ---------- modals / toasts ----------
  const [modals, setModals] = useState<ModalEntry[]>([])
  const openModal = useCallback((render: ModalRender) => {
    const id = ++seq
    const close = () => setModals((m) => m.filter((x) => x.id !== id))
    setModals((m) => [...m, { id, render: () => render(close) }])
    return close
  }, [])
  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        openModal((close) => (
          <ConfirmDialog
            opts={opts}
            onResult={(v) => {
              close()
              resolve(v)
            }}
          />
        ))
      }),
    [openModal],
  )
  const promptText = useCallback(
    (opts: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        openModal((close) => (
          <PromptDialog
            opts={opts}
            onResult={(v) => {
              close()
              resolve(v)
            }}
          />
        ))
      }),
    [openModal],
  )
  const [toasts, setToasts] = useState<Toast[]>([])
  const dismissToast = useCallback((id: number) => setToasts((ts) => ts.filter((x) => x.id !== id)), [])
  const toast = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = ++seq
    setToasts((ts) => [...ts.slice(-3), { id, kind, text }])
    setTimeout(() => dismissToast(id), kind === 'error' ? 7000 : 3500)
  }, [dismissToast])
  const [stopped, setStopped] = useState(false)
  const [tutorialOpen, setTutorialOpen] = useState(false) // replay from Settings (first run is driven by settings.onboarding_done)
  const [focusMode, setFocusMode] = useState(false) // lesson focus: video + content only, sidebar and chrome hidden

  // ---------- library ----------
  const [storedProjects, setProjects] = useState<Project[]>([])
  // The Inbox stores "" until the user names it: shown in the interface language (one place for every view).
  const projects = useMemo(
    () => storedProjects.map((p) => (p.id === INBOX_ID ? { ...p, name: p.name || t('library.inbox'), description: p.description || t('library.inboxDescription') } : p)),
    [storedProjects, t],
  )
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(async () => {
    const [p, l] = await Promise.all([api.projects(), api.lessons()])
    setProjects(p)
    setLessons(l)
    setLoading(false)
  }, [])

  const createProject = useCallback(async (data: ProjectCreate) => {
    const p = await api.createProject(data)
    await refresh()
    return p
  }, [refresh])
  const patchProject = useCallback(async (id: string, patch: ProjectPatch) => {
    await api.patchProject(id, patch)
    await refresh()
  }, [refresh])
  const setProjectCover = useCallback(async (id: string, file: File | null) => {
    const updated = file ? await api.setCover(id, file) : await api.removeCover(id)
    setProjects((ps) => ps.map((p) => (p.id === id ? { ...p, cover: updated.cover } : p)))
  }, [])
  const deleteProject = useCallback(async (id: string) => {
    await api.deleteProject(id)
    await refresh()
  }, [refresh])
  const patchLesson = useCallback(async (id: string, patch: LessonPatch) => {
    const updated = await api.patchLesson(id, patch)
    setLessons((ls) => ls.map((l) => (l.id === id ? updated : l)))
    if (patch.project_id) void refresh()
    return updated
  }, [refresh])
  const deleteLesson = useCallback(async (id: string) => {
    await api.deleteLesson(id)
    await refresh()
  }, [refresh])
  const projectName = useCallback((id: string) => projects.find((p) => p.id === id)?.name ?? '', [projects])

  // ---------- jobs (SSE) ----------
  const [jobs, setJobs] = useState<Job[]>([])
  const [connected, setConnected] = useState(true)
  const prevStatus = useRef(new Map<string, string>())

  useEffect(() => {
    api.settings().then(setSettings, () => setConnected(false))
    Promise.all([api.projects(), api.lessons()]).then(
      ([p, l]) => {
        setProjects(p)
        setLessons(l)
        setLoading(false)
      },
      () => setLoading(false),
    )
  }, [])

  useEffect(() => {
    if (stopped) return
    return api.subscribeJobs(
      (list) => {
        setConnected(true)
        setJobs(list)
        // a job just finished -> library changed
        let finished = false
        for (const j of list) {
          const before = prevStatus.current.get(j.id)
          if (before && before !== j.status && j.status === 'completed') finished = true
          prevStatus.current.set(j.id, j.status ?? '')
        }
        if (finished) void refresh()
      },
      () => setConnected(false),
    )
  }, [refresh, stopped])

  const activeJobs = useMemo(() => jobs.filter((j) => j.status === 'pending' || j.status === 'processing'), [jobs])

  const [uploads, setUploads] = useState<LocalUpload[]>([])
  const trackUpload = useCallback((name: string) => {
    const id = ++seq
    setUploads((u) => [...u, { id, name, progress: 0 }])
    return {
      progress: (f: number) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, progress: f } : x))),
      done: () => setUploads((u) => u.filter((x) => x.id !== id)),
    }
  }, [])

  // ---------- values ----------
  const ui = useMemo<UIContextValue>(() => ({
    settings, reloadSettings, patchSettings, replaceSettings: setSettings, lang, t,
    openModal, confirm, promptText, toast, modals, toasts, dismissToast, stopped, setStopped, tutorialOpen, setTutorialOpen, focusMode, setFocusMode,
  }), [settings, reloadSettings, patchSettings, lang, t, openModal, confirm, promptText, toast, modals, toasts, dismissToast, stopped, tutorialOpen, focusMode])

  const library = useMemo<LibraryContextValue>(() => ({
    projects, lessons, loading, refresh, createProject, patchProject, setProjectCover, deleteProject, patchLesson, deleteLesson, projectName,
  }), [projects, lessons, loading, refresh, createProject, patchProject, setProjectCover, deleteProject, patchLesson, deleteLesson, projectName])

  const jobsValue = useMemo<JobsContextValue>(() => ({ jobs, activeJobs, connected, uploads, trackUpload }), [jobs, activeJobs, connected, uploads, trackUpload])

  return (
    <UIContext.Provider value={ui}>
      <LibraryContext.Provider value={library}>
        <JobsContext.Provider value={jobsValue}>{children}</JobsContext.Provider>
      </LibraryContext.Provider>
    </UIContext.Provider>
  )
}
