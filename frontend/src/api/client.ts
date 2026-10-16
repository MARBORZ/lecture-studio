import type {
  AIProvider, AskRequest, Attachment, DiaryCategory, DiaryEntry, ExportResult, Job, JobOptions, Lesson, LessonFull, LessonPatch, LessonStatus,
  PathCheckResult, PipelineDefaults, Project, PromptView, ProjectCreate, ProjectPatch, ProviderInfo, SessionInfo, SessionPatch, SettingsPatch, SettingsView, SystemStatus,
  Thread, ThreadKind, ComputeStatus, MediaInfo, UninstallPlan, UpdateInfo, FeedbackDraft, FeedbackFile, FeedbackSend, FeedbackResult,
} from './types'
import { tr } from '@/i18n'

export class ApiError extends Error {
  status: number
  detail: unknown

  constructor(status: number, detail: unknown) {
    super(ApiError.message(detail, status))
    this.status = status
    this.detail = detail
  }

  static message(detail: unknown, status: number): string {
    if (typeof detail === 'string') return detail
    if (detail && typeof detail === 'object' && 'message' in detail) return String((detail as { message: unknown }).message)
    if (Array.isArray(detail)) return detail.map((d) => d?.msg ?? '').join('; ')
    return `HTTP ${status}`
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}))
    throw new ApiError(res.status, payload?.detail ?? payload)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

const get = <T>(path: string) => request<T>('GET', path)

/** ?a=1&b=x&b=y — arrays repeat the key, empty values are skipped. */
function query(params: Record<string, string | string[] | null | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => q.append(k, x))
    else if (v) q.set(k, v)
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

/** What a thread read is computed for: the context meter must match the next question. */
export interface ThreadView { session?: string; provider?: AIProvider; sources?: string[] | null }

const threadUrl = (kind: ThreadKind, id: string) => `/api/assistant/${kind}/${id}`
const diaryPath = (id: string) => id.split('/').map(encodeURIComponent).join('/')
const qs = (params: Record<string, string | undefined>) => {
  const p = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])))
  return p.size ? `?${p}` : ''
}

export interface UploadHandle<T> {
  promise: Promise<T>
  abort: () => void
}

/** Raw streamed PUT of a file with progress (XHR: fetch has no upload progress). Shared by every upload. */
function putFile<T>(url: string, file: File, onProgress: (fraction: number) => void): UploadHandle<T> {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<T>((resolve, reject) => {
    xhr.open('PUT', url)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => {
      const body = JSON.parse(xhr.responseText || '{}')
      if (xhr.status >= 400) reject(new ApiError(xhr.status, body?.detail))
      else resolve(body as T)
    }
    xhr.onerror = () => reject(new ApiError(0, tr('error.network')))
    xhr.onabort = () => reject(new ApiError(0, tr('error.uploadCancelled')))
    xhr.send(file)
  })
  return { promise, abort: () => xhr.abort() }
}

export const api = {
  // system
  status: () => get<SystemStatus>('/api/system/status'),
  shutdown: () => request<{ ok: boolean }>('POST', '/api/system/shutdown'),
  /** force: always ask origin; reload: ask origin unless the server's answer is under 30 s old (page start). */
  update: (force = false, reload = false) => get<UpdateInfo>(`/api/system/update${force ? '?force=true' : reload ? '?reload=true' : ''}`),
  applyUpdate: () => request<UpdateInfo>('POST', '/api/system/update'),
  discardUpdateChanges: () => request<UpdateInfo>('POST', '/api/system/update/discard'),
  uninstallPlan: () => get<UninstallPlan>('/api/system/uninstall'),
  // feedback to the developer: a draft (the server times the form), its files, then send
  feedbackDraft: () => request<FeedbackDraft>('POST', '/api/feedback/drafts'),
  feedbackFile: (draftId: string, file: File, onProgress: (fraction: number) => void) =>
    putFile<FeedbackFile>(`/api/feedback/drafts/${draftId}/files/${encodeURIComponent(file.name)}`, file, onProgress),
  feedbackRemoveFile: (draftId: string, name: string) => request<{ ok: boolean }>('DELETE', `/api/feedback/drafts/${draftId}/files/${encodeURIComponent(name)}`),
  feedbackDiscard: (draftId: string) => request<{ ok: boolean }>('DELETE', `/api/feedback/drafts/${draftId}`),
  feedbackSend: (draftId: string, form: FeedbackSend) => request<FeedbackResult>('POST', `/api/feedback/drafts/${draftId}/send`, form),
  uninstall: (deleteLessons: boolean) => request<{ ok: boolean; kept?: string | null }>('POST', '/api/system/uninstall', { delete_lessons: deleteLessons }),

  // settings
  settings: () => get<SettingsView>('/api/settings'),
  patchSettings: (patch: SettingsPatch) => request<SettingsView>('PATCH', '/api/settings', patch),
  compute: () => get<ComputeStatus>('/api/settings/compute'),
  providers: () => get<Record<string, ProviderInfo>>('/api/settings/providers'),
  prompts: () => get<PromptView[]>('/api/settings/prompts'),
  savePrompt: (key: string, value: string) => request<PromptView[]>('PUT', `/api/settings/prompts/${key}`, { value }),
  resetPrompt: (key: string) => request<PromptView[]>('DELETE', `/api/settings/prompts/${key}`),
  testKey: (provider: AIProvider) => request<{ ok: boolean; model: string; error?: string }>('POST', '/api/settings/test-key', { provider }),
  checkPath: (path: string) => request<PathCheckResult>('POST', '/api/settings/check-path', { path }),
  changeDataDir: (path: string, mode: 'attach' | 'move') => request<SettingsView>('POST', '/api/settings/data-dir', { path, mode }),

  // projects
  projects: () => get<Project[]>('/api/projects'),
  createProject: (data: ProjectCreate) => request<Project>('POST', '/api/projects', data),
  patchProject: (id: string, patch: ProjectPatch) => request<Project>('PATCH', `/api/projects/${id}`, patch),
  setCover: (id: string, file: File) => putFile<Project>(`/api/projects/${id}/cover`, file, () => undefined).promise,
  removeCover: (id: string) => request<Project>('DELETE', `/api/projects/${id}/cover`),
  /** null without a cover; the file name in ?v= changes with the image, so the browser may cache it for good */
  coverUrl: (p: Pick<Project, 'id' | 'cover'>) => (p.cover ? `/api/projects/${p.id}/cover?v=${encodeURIComponent(p.cover)}` : null),
  deleteProject: (id: string) => request<{ ok: boolean }>('DELETE', `/api/projects/${id}`),

  // lessons
  lessons: (filter: { project_id?: string; status?: LessonStatus; search?: string } = {}) => get<Lesson[]>(`/api/lessons${qs(filter)}`),
  lesson: (id: string) => get<LessonFull>(`/api/lessons/${id}`),
  patchLesson: (id: string, patch: LessonPatch) => request<Lesson>('PATCH', `/api/lessons/${id}`, patch),
  deleteLesson: (id: string) => request<{ ok: boolean }>('DELETE', `/api/lessons/${id}`),
  exportLesson: (id: string, target_dir?: string, title?: string) =>
    request<ExportResult>('POST', `/api/lessons/${id}/export`, { target_dir: target_dir || null, title: title || null }),
  transcribe: (id: string, transcriber: 'whisper' | 'gemini') => request<Job>('POST', `/api/lessons/${id}/transcribe`, { transcriber }),
  relink: (id: string, path: string) => request<Lesson>('POST', `/api/lessons/${id}/relink`, { path }),
  dropVideo: (id: string) => request<Lesson>('POST', `/api/lessons/${id}/drop-video`),
  inspectMedia: (path: string) => request<MediaInfo>('POST', '/api/media/inspect', { path }),
  regenerateAudit: (
    id: string,
    provider?: AIProvider,
    audit_mode?: 'srt_timecodes' | 'clean_summary',
    source: 'transcript' | 'video' = 'transcript',
    language: PipelineDefaults['output_language'] = 'interface',
  ) => request<Job>('POST', `/api/lessons/${id}/audit`, { provider, audit_mode, source, language }),
  fileUrl: (id: string, kind: string) => `/api/lessons/${id}/files/${kind}`,

  // jobs
  startJob: (options: Partial<JobOptions>, upload_id?: string) => request<Job>('POST', '/api/jobs', { options, upload_id }),
  cancelJob: (id: string) => request<{ ok: boolean }>('POST', `/api/jobs/${id}/cancel`),

  /** Media for processing (Studio). */
  upload: (file: File, onProgress: (fraction: number) => void) =>
    putFile<{ upload_id: string; size: number }>(`/api/uploads/${encodeURIComponent(file.name)}`, file, onProgress),

  /** SSE: full job list on every change. Returns unsubscribe. */
  subscribeJobs(onJobs: (jobs: Job[]) => void, onError?: () => void): () => void {
    const es = new EventSource('/api/jobs/stream')
    es.onmessage = (e) => onJobs(JSON.parse(e.data) as Job[])
    es.onerror = () => onError?.()
    return () => es.close()
  },

  // diary (entry ids are "<category>/<file>.md"; encode each segment)
  diaryCategories: () => get<DiaryCategory[]>('/api/diary/categories'),
  createDiaryCategory: (name: string) => request<DiaryCategory>('POST', '/api/diary/categories', { name }),
  renameDiaryCategory: (name: string, to: string) => request<DiaryCategory>('PATCH', `/api/diary/categories/${encodeURIComponent(name)}`, { name: to }),
  deleteDiaryCategory: (name: string) => request<{ moved: number }>('DELETE', `/api/diary/categories/${encodeURIComponent(name)}`),
  diaryEntries: (category?: string, q?: string) => get<DiaryEntry[]>(`/api/diary/entries${qs({ category, q })}`),
  createDiaryEntry: (text: string, category?: string) => request<DiaryEntry>('POST', '/api/diary/entries', { text, category }),
  updateDiaryEntry: (id: string, patch: { text?: string; category?: string }) => request<DiaryEntry>('PUT', `/api/diary/entries/${diaryPath(id)}`, patch),
  deleteDiaryEntry: (id: string) => request<{ ok: boolean }>('DELETE', `/api/diary/entries/${diaryPath(id)}`),

  // assistant
  thread: (kind: ThreadKind, id: string, view: ThreadView) =>
    get<Thread>(threadUrl(kind, id) + query({ session: view.session, provider: view.provider, sources: view.sources ?? undefined })),
  ask: (kind: ThreadKind, id: string, req: AskRequest) => request<Thread>('POST', threadUrl(kind, id), req),
  newSession: (kind: ThreadKind, id: string) => request<SessionInfo>('POST', `${threadUrl(kind, id)}/sessions`),
  activateSession: (kind: ThreadKind, id: string, sid: string) => request<{ ok: boolean }>('PUT', `${threadUrl(kind, id)}/sessions/${sid}/active`),
  patchSession: (kind: ThreadKind, id: string, sid: string, patch: SessionPatch) => request<{ ok: boolean }>('PATCH', `${threadUrl(kind, id)}/sessions/${sid}`, patch),
  clearSession: (kind: ThreadKind, id: string, sid: string) => request<{ ok: boolean }>('POST', `${threadUrl(kind, id)}/sessions/${sid}/clear`),
  compactSession: (kind: ThreadKind, id: string, sid: string, view: ThreadView) =>
    request<Thread>('POST', `${threadUrl(kind, id)}/sessions/${sid}/compact`, { provider: view.provider, sources: view.sources ?? null }),
  deleteSession: (kind: ThreadKind, id: string, sid: string) => request<{ ok: boolean }>('DELETE', `${threadUrl(kind, id)}/sessions/${sid}`),
  uploadAttachment: (file: File, onProgress: (fraction: number) => void) =>
    putFile<Attachment>(`/api/assistant/attachments/${encodeURIComponent(file.name)}`, file, onProgress),
  attachmentUrl: (id: string) => `/api/assistant/attachments/${id}/file`,
}
