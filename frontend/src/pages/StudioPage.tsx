import { ArrowLeft, ArrowRight, Check, FileVideo, HardDrive, Play, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { api } from '@/api/client'
import type { MediaInfo, PipelineDefaults } from '@/api/types'
import { useJobs, useLibrary, useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Appear } from '@/components/motion'
import { Button, Card, EmptyState, Field, Input, Page, PageHeader, Progress, Segmented, Select, Switch } from '@/components/ui'
import { FALLBACK_DEFAULTS, PipelineOptionsFields } from '@/features/jobs/PipelineOptionsFields'
import { JobList, type StudioHandoff } from '@/features/jobs/JobList'
import { KeyNotice, PROVIDER_NAME } from '@/features/system/KeyNotice'
import { cn } from '@/lib/cn'
import { formatBytes, formatDuration } from '@/lib/format'

type Source = 'upload' | 'path'
type Opts = Required<PipelineDefaults>

const STEPS = ['file', 'lesson', 'processing', 'start'] as const
type Step = (typeof STEPS)[number]

/** Studio as a wizard: file -> lesson -> processing -> start. The queue stays on the right. */
export function StudioPage() {
  const { t, settings, toast } = useUI()
  const { projects } = useLibrary()
  const { jobs, trackUpload } = useJobs()

  const [step, setStep] = useState<Step>('file')
  const [source, setSource] = useState<Source>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [localPath, setLocalPath] = useState('')
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('proj_inbox')
  const [exportAfter, setExportAfter] = useState(false)
  const [opts, setOpts] = useState<Opts>(FALLBACK_DEFAULTS)
  const [upload, setUpload] = useState<{ progress: number; abort: () => void } | null>(null)
  const [starting, setStarting] = useState(false)

  // a finished download (Videos tab) arrives as a file on disk with its title: the wizard goes on from the lesson step
  const location = useLocation()
  const navigate = useNavigate()
  const handoff = location.state as StudioHandoff | null
  if (handoff?.path && handoff.path !== localPath) {
    setSource('path')
    setLocalPath(handoff.path)
    setTitle(handoff.title)
    setStep('lesson')
  }
  useEffect(() => {
    if (handoff?.path) navigate('.', { replace: true, state: null }) // taken once: a reload starts clean
  }, [handoff, navigate])

  const [defaultsFrom, setDefaultsFrom] = useState<PipelineDefaults>()
  if (settings && settings.pipeline !== defaultsFrom) {
    setDefaultsFrom(settings.pipeline) // settings (re)loaded: start from saved defaults
    setOpts({ ...FALLBACK_DEFAULTS, ...settings.pipeline } as Opts)
  }

  const fileName = source === 'upload' ? file?.name ?? '' : localPath.trim().split(/[\\/]/).pop() ?? ''
  const valid: Record<Step, boolean> = {
    file: source === 'upload' ? Boolean(file) : Boolean(localPath.trim()),
    lesson: true,
    processing: true,
    start: true,
  }
  const index = STEPS.indexOf(step)
  const reachable = (s: Step) => STEPS.slice(0, STEPS.indexOf(s)).every((x) => valid[x])

  const chooseFile = (name: string) => {
    if (!title) setTitle(name.replace(/\.[^.]+$/, ''))
  }

  async function start() {
    setStarting(true)
    const options = { ...opts, lesson_title: title.trim(), project_id: projectId, export_after: exportAfter, local_path: source === 'path' ? localPath.trim() : null }
    try {
      let uploadId: string | undefined
      if (source === 'upload' && file) {
        const tracker = trackUpload(file.name)
        const handle = api.upload(file, (f) => {
          tracker.progress(f)
          setUpload((u) => (u ? { ...u, progress: f } : u))
        })
        setUpload({ progress: 0, abort: handle.abort })
        try {
          uploadId = (await handle.promise).upload_id
        } finally {
          tracker.done()
          setUpload(null)
        }
      }
      await api.startJob(options, uploadId)
      toast(t('studio.started'))
      setFile(null)
      setLocalPath('')
      setTitle('')
      setStep('file')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setStarting(false)
    }
  }

  return (
    <Page width="lg">
      <PageHeader title={t('studio.title')} subtitle={t('studio.subtitle')} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-5">
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {STEPS.map((s, i) => {
              const done = i < index && valid[s]
              return (
                <li key={s}>
                  <button
                    type="button"
                    disabled={!reachable(s)}
                    onClick={() => setStep(s)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-40',
                      s === step ? 'border-fg text-fg' : 'border-line text-muted hover:border-line-strong hover:text-soft',
                    )}
                  >
                    <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px]', done ? 'border-fg bg-fg text-bg' : s === step ? 'border-fg' : 'border-line-strong')}>
                      {done ? <Icon as={Check} size={12} /> : i + 1}
                    </span>
                    <span className="min-w-0 truncate text-[13px]">{t(`studio.step.${s}`)}</span>
                  </button>
                </li>
              )
            })}
          </ol>

          <Appear key={step}>
            {step === 'file' && (
              <FileStep source={source} setSource={setSource} file={file} setFile={(f) => (setFile(f), f && chooseFile(f.name))} localPath={localPath} setLocalPath={(p) => (setLocalPath(p), chooseFile(p.split(/[\\/]/).pop() ?? ''))} />
            )}
            {step === 'lesson' && (
              <Card title={t('studio.step.lesson')} description={t('studio.lessonHint')}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('studio.lessonTitle')}>
                    <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('studio.titlePlaceholder')} autoFocus />
                  </Field>
                  <Field label={t('common.notebook')}>
                    <Select value={projectId} onChange={setProjectId} options={projects.map((p) => ({ value: p.id, label: p.name }))} />
                  </Field>
                </div>
                <div className="mt-5 flex flex-col gap-1.5">
                  <Switch checked={exportAfter} onChange={setExportAfter} disabled={!settings?.paths.export_dir} label={t('studio.exportAfter')} hint={settings?.paths.export_dir || undefined} />
                  {!settings?.paths.export_dir && (
                    // why the switch is off, and where to fix it
                    <p className="pl-11 text-[12px] leading-snug text-muted">
                      {t('studio.exportNoDir')}{' '}
                      <Link to="/settings/paths" className="text-soft underline underline-offset-2 hover:text-fg">{t('studio.exportSetDir')}</Link>
                    </p>
                  )}
                </div>
              </Card>
            )}
            {step === 'processing' && (
              <Card title={t('studio.step.processing')} description={t('studio.modeHint')}>
                <PipelineOptionsFields value={opts} onChange={setOpts} source={source} />
              </Card>
            )}
            {step === 'start' && (
              <Card title={t('studio.step.start')}>
                <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <dt className="text-muted">{t('studio.step.file')}</dt>
                  <dd className="truncate font-mono text-[12.5px] text-fg">{fileName}</dd>
                  <dt className="text-muted">{t('studio.lessonTitle')}</dt>
                  <dd className="truncate text-fg">{title.trim() || t('studio.untitled')}</dd>
                  <dt className="text-muted">{t('common.notebook')}</dt>
                  <dd className="truncate text-fg">{projects.find((p) => p.id === projectId)?.name}</dd>
                  <dt className="text-muted">{t('studio.steps')}</dt>
                  <dd className="text-fg">{stepsLine(opts, t)}</dd>
                  <dt className="text-muted">{t('studio.result')}</dt>
                  <dd className="text-fg">{resultLine(opts, t)}</dd>
                </dl>
                <div className="mt-5 flex flex-col gap-3">
                  {opts.transcriber === 'gemini' && <KeyNotice provider="gemini" />}
                  {opts.audit !== 'none' && opts.audit !== (opts.transcriber === 'gemini' ? 'gemini' : '') && <KeyNotice provider={opts.audit} />}
                  {opts.video === 'original' && source === 'path' && <p className="text-[12.5px] text-soft">{t('opt.video.original.path')}</p>}
                  {upload && (
                    <div className="flex items-center gap-4 rounded-xl border border-line-strong p-4">
                      <div className="flex-1">
                        <div className="mb-2 flex justify-between text-[13px]">
                          <span>{t('studio.uploading')}</span>
                          <span className="font-mono">{Math.round(upload.progress * 100)}%</span>
                        </div>
                        <Progress value={upload.progress * 100} />
                      </div>
                      <Button size="sm" variant="ghost" icon={X} onClick={upload.abort}>{t('common.cancel')}</Button>
                    </div>
                  )}
                </div>
              </Card>
            )}
          </Appear>

          <div className="flex items-center gap-2">
            {index > 0 && (
              <Button variant="ghost" icon={ArrowLeft} disabled={Boolean(upload)} onClick={() => setStep(STEPS[index - 1])}>
                {t('common.back')}
              </Button>
            )}
            <div className="flex-1" />
            {step === 'start' ? (
              <Button variant="primary" size="lg" icon={Play} disabled={!valid.file || Boolean(upload)} loading={starting} onClick={start}>
                {t('studio.start')}
              </Button>
            ) : (
              <Button variant="primary" iconRight={ArrowRight} disabled={!valid[step]} onClick={() => setStep(STEPS[index + 1])}>
                {t('common.next')}
              </Button>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="label-caps">{t('studio.queue')}</div>
          {jobs.length ? (
            <JobList jobs={jobs} />
          ) : (
            <EmptyState icon={Play} title={t('studio.queueEmpty')} />
          )}
        </div>
      </div>
    </Page>
  )
}

function resultLine(o: Opts, t: ReturnType<typeof useUI>['t']): string {
  const parts = [o.video === 'original' ? t('studio.res.original') : o.cut_silence ? t('studio.res.audio') : t('studio.res.audioFull')]
  if (o.video === 'clean') parts.push(t('studio.res.video'))
  if (o.video === 'compressed') parts.push(t('studio.res.videoCompressed'))
  if (o.transcriber !== 'none') parts.push(t('studio.res.transcript'))
  if (o.audit !== 'none') parts.push(o.audit_source === 'video' ? t('studio.res.auditVideo') : t('studio.res.audit'))
  return parts.join(' · ')
}

/** "Pauses cut · Whisper · audit DeepSeek" — what each step will do. */
function stepsLine(o: Opts, t: ReturnType<typeof useUI>['t']): string {
  return [
    o.cut_silence ? t('studio.steps.cut') : t('studio.steps.noCut'),
    t(`opt.video.${o.video}`),
    o.transcriber === 'none' ? t('studio.steps.noText') : o.transcriber === 'gemini' ? 'Gemini' : 'Whisper',
    o.audit === 'none' ? t('studio.steps.noAudit') : `${t('opt.step.audit')}: ${o.audit === 'local' ? t('ai.local.short') : PROVIDER_NAME[o.audit]}`,
  ].join(' · ')
}

function FileStep({ source, setSource, file, setFile, localPath, setLocalPath }: {
  source: Source
  setSource: (s: Source) => void
  file: File | null
  setFile: (f: File | null) => void
  localPath: string
  setLocalPath: (p: string) => void
}) {
  const { t, lang } = useUI()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  return (
    <Card
      title={t('studio.step.file')}
      description={t('studio.fileHint')}
      actions={<Segmented size="sm" value={source} onChange={setSource} options={[{ value: 'upload', label: t('studio.upload') }, { value: 'path', label: t('studio.path') }]} />}
    >
      {source === 'upload' ? (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0])
          }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center transition-colors',
            dragging ? 'border-fg bg-raised' : 'border-line-strong hover:border-muted',
          )}
        >
          <input ref={inputRef} type="file" accept="video/*,audio/*,.mov,.mkv" hidden onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])} />
          {file ? (
            <>
              <Icon as={FileVideo} size={22} />
              <span className="max-w-full truncate text-[14px] text-fg">{file.name}</span>
              <span className="font-mono text-[12px] text-muted">{formatBytes(file.size, lang)}</span>
              <button type="button" onClick={(e) => (e.stopPropagation(), setFile(null))} className="mt-1 flex items-center gap-1 text-[12px] text-muted hover:text-fg">
                <Icon as={X} size={12} /> {t('common.cancel')}
              </button>
            </>
          ) : (
            <>
              <Icon as={Upload} size={22} className="text-muted" />
              <span className="text-[14px] text-fg">{t('studio.drop')}</span>
              <span className="text-[12px] text-muted">{t('studio.dropHint')}</span>
            </>
          )}
        </div>
      ) : (
        <Field hint={t('studio.pathHint')}>
          <div className="relative">
            <Icon as={HardDrive} size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-dim" />
            <Input value={localPath} onChange={(e) => setLocalPath(e.target.value)} placeholder={t('studio.pathPlaceholder')} className="pl-8 font-mono text-[12.5px]" autoFocus />
          </div>
          <PathInfo path={localPath} />
        </Field>
      )}
    </Card>
  )
}


/** What is at the path: length, size, video or sound only, and whether the app plays the original as is (Eco). */
function PathInfo({ path }: { path: string }) {
  const { t, lang } = useUI()
  const [info, setInfo] = useState<{ path: string; data?: MediaInfo; error?: string } | null>(null)
  useEffect(() => {
    const p = path.trim()
    if (!p) return
    const id = setTimeout(() => {
      api.inspectMedia(p).then(
        (data) => setInfo({ path: p, data }),
        (e: Error) => setInfo({ path: p, error: e.message }),
      )
    }, 500)
    return () => clearTimeout(id)
  }, [path])
  if (!info || info.path !== path.trim()) return null
  if (info.error) return <p className="mt-2 text-[12.5px] text-fg">{info.error}</p>
  const d = info.data!
  return (
    <div className="mt-2 flex flex-col gap-1 text-[12.5px] text-muted">
      <span className="font-mono">
        {formatDuration(d.duration_sec, lang)} · {formatBytes(d.size_mb * 1024 * 1024, lang)} · {d.has_video ? t('studio.info.video') : t('studio.info.audio')}
      </span>
      {d.playback_problem && <span className="text-soft">{t('studio.info.playback', { problem: d.playback_problem })}</span>}
    </div>
  )
}
