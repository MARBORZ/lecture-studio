import type {
  AIProvider, AskRequest, Attachment, ChatMessage, DiaryCategory, DiaryEntry, ExportResult, Job, JobOptions, Lesson, LessonFull, LessonPatch, LessonStatus,
  PathCheckResult, Project, PromptView, ProjectCreate, ProjectPatch, ProviderInfo, SettingsPatch, SettingsView, SystemStatus, Thread,
} from './types'

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
    xhr.onerror = () => reject(new ApiError(0, 'Сеть недоступна'))
    xhr.onabort = () => reject(new ApiError(0, 'Загрузка отменена'))
    xhr.send(file)
  })
  return { promise, abort: () => xhr.abort() }
}

export const api = {
  // system
  status: () => get<SystemStatus>('/api/system/status'),
  shutdown: () => request<{ ok: boolean }>('POST', '/api/system/shutdown'),

  // settings
  settings: () => get<SettingsView>('/api/settings'),
  patchSettings: (patch: SettingsPatch) => request<SettingsView>('PATCH', '/api/settings', patch),
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
  deleteProject: (id: string) => request<{ ok: boolean }>('DELETE', `/api/projects/${id}`),

  // lessons
  lessons: (filter: { project_id?: string; status?: LessonStatus; search?: string } = {}) => get<Lesson[]>(`/api/lessons${qs(filter)}`),
  lesson: (id: string) => get<LessonFull>(`/api/lessons/${id}`),
  patchLesson: (id: string, patch: LessonPatch) => request<Lesson>('PATCH', `/api/lessons/${id}`, patch),
  deleteLesson: (id: string) => request<{ ok: boolean }>('DELETE', `/api/lessons/${id}`),
  exportLesson: (id: string, target_dir?: string, title?: string) =>
    request<ExportResult>('POST', `/api/lessons/${id}/export`, { target_dir: target_dir || null, title: title || null }),
  regenerateAudit: (id: string, provider?: AIProvider, audit_mode?: 'srt_timecodes' | 'clean_summary') =>
    request<Job>('POST', `/api/lessons/${id}/audit`, { provider, audit_mode }),
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
  thread: (kind: 'project' | 'lesson', id: string) => get<Thread>(`/api/assistant/${kind}/${id}`),
  ask: (kind: 'project' | 'lesson', id: string, req: AskRequest) => request<ChatMessage[]>('POST', `/api/assistant/${kind}/${id}`, req),
  uploadAttachment: (file: File, onProgress: (fraction: number) => void) =>
    putFile<Attachment>(`/api/assistant/attachments/${encodeURIComponent(file.name)}`, file, onProgress),
  attachmentUrl: (id: string) => `/api/assistant/attachments/${id}/file`,
  clearThread: (kind: 'project' | 'lesson', id: string) => request<{ ok: boolean }>('DELETE', `/api/assistant/${kind}/${id}`),
}
