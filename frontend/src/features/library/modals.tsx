import { FolderOutput, ImagePlus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { api } from '@/api/client'
import type { Lesson, LessonStatus, Project } from '@/api/types'
import { useLibrary, useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Button, Field, IconButton, Input, Modal, Select, Textarea } from '@/components/ui'
import { NotebookCover } from './NotebookCover'

/** Shared submit wrapper: busy flag + error toast. */
function useSubmit(fn: () => Promise<void>) {
  const { toast } = useUI()
  const [busy, setBusy] = useState(false)
  const onSubmit = async (e?: FormEvent) => {
    e?.preventDefault()
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return { busy, onSubmit }
}

export function ProjectFormModal({ project, close }: { project?: Project; close: () => void }) {
  const { t } = useUI()
  const { createProject, patchProject, setProjectCover } = useLibrary()
  const navigate = useNavigate()
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  // undefined = keep the current cover, File = new image, null = remove
  const [cover, setCover] = useState<File | null | undefined>(undefined)
  const { busy, onSubmit } = useSubmit(async () => {
    const id = project ? project.id : (await createProject({ name, description })).id
    // only what changed: an untouched Inbox keeps following the interface language
    if (project) await patchProject(project.id, { ...(name !== project.name && { name }), ...(description !== project.description && { description }) })
    if (cover !== undefined) await setProjectCover(id, cover)
    if (!project) navigate(`/library/${id}`)
    close()
  })

  return (
    <Modal
      title={project ? t('library.edit') : t('nav.newNotebook')}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => onSubmit()}>
            {project ? t('common.save') : t('common.create')}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <CoverPicker project={project} name={name} value={cover} onChange={setCover} />
        <Field label={t('common.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        <Field label={t('common.description')}>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

/** Notebook picture: click or drop an image; preview right away, saved with the form. */
function CoverPicker({ project, name, value, onChange }: { project?: Project; name: string; value: File | null | undefined; onChange: (v: File | null) => void }) {
  const { t } = useUI()
  const input = useRef<HTMLInputElement>(null)
  const preview = useMemo(() => (value ? URL.createObjectURL(value) : null), [value])
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])
  const shown = value === null ? null : preview ?? (project ? api.coverUrl(project) : null)
  const pick = (f?: File | null) => f && f.type.startsWith('image/') && onChange(f)

  return (
    <div
      className="flex items-center gap-4"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        pick(e.dataTransfer.files[0])
      }}
    >
      <button type="button" onClick={() => input.current?.click()} title={t('library.coverPick')} className="group relative">
        <NotebookCover project={{ id: project?.id ?? 'new', name: name || '?', cover: '' }} src={shown} className="size-20 text-[28px]" />
        <span className="absolute inset-0 flex items-center justify-center rounded-[5px] bg-bg/70 opacity-0 transition-opacity group-hover:opacity-100">
          <Icon as={ImagePlus} size={20} />
        </span>
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="text-[13px] text-fg">{t('library.cover')}</div>
        <div className="text-[12px] text-muted">{t('library.coverHint')}</div>
        <div className="flex gap-1.5">
          <Button size="sm" icon={ImagePlus} onClick={() => input.current?.click()}>{t('library.coverPick')}</Button>
          {shown && <IconButton icon={X} size="sm" label={t('library.coverRemove')} onClick={() => onChange(null)} />}
        </div>
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ''))} />
    </div>
  )
}

export function LessonEditModal({ lesson, close }: { lesson: Lesson; close: () => void }) {
  const { t } = useUI()
  const { projects, patchLesson } = useLibrary()
  const [form, setForm] = useState({ title: lesson.title ?? '', project_id: lesson.project_id ?? 'proj_inbox', status: lesson.status ?? 'in_progress', tags: lesson.tags ?? '', notes: lesson.notes ?? '' })
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))
  const { busy, onSubmit } = useSubmit(async () => {
    await patchLesson(lesson.id, form)
    close()
  })

  return (
    <Modal
      title={t('lesson.edit')}
      width="lg"
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={busy} disabled={!form.title.trim()} onClick={() => onSubmit()}>{t('common.save')}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <Field label={t('common.name')} className="sm:col-span-2">
          <Input value={form.title} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label={t('common.notebook')}>
          <Select value={form.project_id} onChange={(v) => set('project_id', v)} options={projects.map((p) => ({ value: p.id, label: p.name }))} />
        </Field>
        <Field label={t('common.status')}>
          <Select
            value={form.status}
            onChange={(v) => set('status', v as LessonStatus)}
            options={(['in_progress', 'to_review', 'completed'] as const).map((s) => ({ value: s, label: t(`status.${s}`) }))}
          />
        </Field>
        <Field label={t('common.tags')} className="sm:col-span-2">
          <Input value={form.tags} onChange={(e) => set('tags', e.target.value)} />
        </Field>
        <Field label={t('common.notes')} className="sm:col-span-2">
          <Textarea rows={8} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

export function ExportModal({ lesson, close }: { lesson: Lesson; close: () => void }) {
  const { t, settings, toast } = useUI()
  const [target, setTarget] = useState(settings?.paths.export_dir ?? '')
  const [title, setTitle] = useState(lesson.title ?? '')
  const { busy, onSubmit } = useSubmit(async () => {
    const res = await api.exportLesson(lesson.id, target.trim() || undefined, title.trim() || undefined)
    toast(`${t('files.exportDone')}: ${res.count} → ${res.target_dir}`)
    close()
  })

  return (
    <Modal
      title={t('files.export')}
      description={t('files.exportHint')}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>{t('common.cancel')}</Button>
          <Button variant="primary" icon={FolderOutput} loading={busy} disabled={!target.trim()} onClick={() => onSubmit()}>{t('files.export')}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label={t('files.exportTarget')} hint={settings?.paths.export_dir ? `${t('files.exportDefault')}: ${settings.paths.export_dir}` : undefined}>
          <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="/Users/…/Obsidian/Course" className="font-mono text-[12.5px]" />
        </Field>
        <Field label={t('common.name')}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
