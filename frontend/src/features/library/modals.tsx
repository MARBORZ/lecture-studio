import { FolderOutput } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { api } from '@/api/client'
import type { Lesson, LessonStatus, Project } from '@/api/types'
import { useLibrary, useUI } from '@/app/AppProvider'
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui'

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
  const { createProject, patchProject } = useLibrary()
  const navigate = useNavigate()
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const { busy, onSubmit } = useSubmit(async () => {
    if (project) await patchProject(project.id, { name, description })
    else navigate(`/library/${(await createProject({ name, description })).id}`)
    close()
  })

  return (
    <Modal
      title={project ? t('library.rename') : t('nav.newNotebook')}
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
