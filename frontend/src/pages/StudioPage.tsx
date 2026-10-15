import { ChevronDown, FileVideo, HardDrive, Play, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { api } from '@/api/client'
import type { PipelineDefaults } from '@/api/types'
import { useJobs, useLibrary, useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { AnimatePresence, ListItem, m } from '@/components/motion'
import { collapse } from '@/lib/motion'
import { Button, Card, EmptyState, Field, Input, Page, PageHeader, Progress, Segmented, Select, Switch } from '@/components/ui'
import { FALLBACK_DEFAULTS, PipelineOptionsFields } from '@/features/jobs/PipelineOptionsFields'
import { JobCard } from '@/features/jobs/JobCard'
import { KeyNotice } from '@/features/system/KeyNotice'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/format'

type Source = 'upload' | 'path'
type Opts = Required<PipelineDefaults>

export function StudioPage() {
  const { t, settings, toast, lang } = useUI()
  const { projects } = useLibrary()
  const { jobs, trackUpload } = useJobs()

  const [source, setSource] = useState<Source>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [localPath, setLocalPath] = useState('')
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState('proj_inbox')
  const [exportAfter, setExportAfter] = useState(false)
  const [opts, setOpts] = useState<Opts>(FALLBACK_DEFAULTS)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [upload, setUpload] = useState<{ progress: number; abort: () => void } | null>(null)
  const [starting, setStarting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const [defaultsFrom, setDefaultsFrom] = useState<PipelineDefaults>()
  if (settings && settings.pipeline !== defaultsFrom) {
    setDefaultsFrom(settings.pipeline) // settings (re)loaded: start from saved defaults
    setOpts({ ...FALLBACK_DEFAULTS, ...settings.pipeline } as Opts)
  }

  const pick = (f: File | undefined) => {
    if (!f) return
    setFile(f)
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''))
  }

  const ready = source === 'upload' ? Boolean(file) : Boolean(localPath.trim())

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
      setFile(null)
      setLocalPath('')
      setTitle('')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setStarting(false)
    }
  }

  return (
    <Page width="lg">
      <PageHeader title={t('studio.title')} subtitle={t('studio.subtitle')} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-6">
          <Card title={t('studio.source')} actions={<Segmented size="sm" value={source} onChange={setSource} options={[{ value: 'upload', label: t('studio.upload') }, { value: 'path', label: t('studio.path') }]} />}>
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
                  pick(e.dataTransfer.files[0])
                }}
                onClick={() => inputRef.current?.click()}
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center transition-colors',
                  dragging ? 'border-fg bg-raised' : 'border-line-strong hover:border-muted',
                )}
              >
                <input ref={inputRef} type="file" accept="video/*,audio/*,.mov,.mkv" hidden onChange={(e) => pick(e.target.files?.[0])} />
                {file ? (
                  <>
                    <Icon as={FileVideo} size={22} />
                    <span className="text-[14px] text-fg">{file.name}</span>
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
                  <Input
                    value={localPath}
                    onChange={(e) => {
                      setLocalPath(e.target.value)
                      if (!title) setTitle(e.target.value.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '')
                    }}
                    placeholder={t('studio.pathPlaceholder')}
                    className="pl-8 font-mono text-[12.5px]"
                  />
                </div>
              </Field>
            )}

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label={t('studio.lessonTitle')}>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('studio.titlePlaceholder')} />
              </Field>
              <Field label={t('common.notebook')}>
                <Select value={projectId} onChange={setProjectId} options={projects.map((p) => ({ value: p.id, label: p.name }))} />
              </Field>
            </div>
            <div className="mt-5">
              <Switch checked={exportAfter} onChange={setExportAfter} disabled={!settings?.paths.export_dir} label={t('studio.exportAfter')} hint={settings?.paths.export_dir || t('settings.exportDirHint')} />
            </div>
          </Card>

          <Card padded={false}>
            <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="flex w-full items-center justify-between px-5 py-3.5 text-left">
              <span>
                <span className="block text-[13.5px] font-semibold">{t('studio.advanced')}</span>
                <span className="block text-[12.5px] text-muted">{t('studio.defaultsHint')}</span>
              </span>
              <Icon as={ChevronDown} size={16} className={cn('text-muted transition-transform', showAdvanced && 'rotate-180')} />
            </button>
            <AnimatePresence initial={false}>
              {showAdvanced && (
                <m.div key="advanced" variants={collapse} initial="hidden" animate="show" exit="exit" className="overflow-hidden">
                  <div className="border-t border-line p-5">
                    <PipelineOptionsFields value={opts} onChange={setOpts} />
                  </div>
                </m.div>
              )}
            </AnimatePresence>
          </Card>

          {opts.mode === 'gemini' ? <KeyNotice provider="gemini" /> : opts.mode === 'deepseek' && opts.generate_audit ? <KeyNotice provider="deepseek" /> : null}

          {upload ? (
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
          ) : (
            <Button variant="primary" size="lg" icon={Play} className="self-start" disabled={!ready} loading={starting} onClick={start}>
              {t('studio.start')}
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="label-caps">{t('studio.queue')}</div>
          {jobs.length ? (
            <AnimatePresence initial={false}>
              {jobs.map((j, i) => (
                <ListItem key={j.id} index={i}>
                  <JobCard job={j} />
                </ListItem>
              ))}
            </AnimatePresence>
          ) : (
            <EmptyState icon={Play} title={t('studio.queueEmpty')} />
          )}
        </div>
      </div>
    </Page>
  )
}
