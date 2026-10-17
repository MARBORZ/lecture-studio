import { FolderOutput, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import type { Lesson, LessonFull, LessonStatus } from '@/api/types'
import { useLibrary, useUI } from '@/app/AppProvider'
import { IconButton, Segmented } from '@/components/ui'
import { SkeletonText } from '@/components/skeleton'
import { ExportModal, LessonEditModal } from '@/features/library/modals'
import { MoveLessonButton } from '@/features/library/MoveLesson'

/** The lesson's header: notebook link and title, status, and the lesson actions (edit, move, regenerate, export, delete). */
export function LessonHeader({ lessonId, current, meta, onRegenerate }: { lessonId: string; current: Lesson | LessonFull | undefined | null; meta: Lesson | undefined; onRegenerate: () => void }) {
  const navigate = useNavigate()
  const { t, openModal, confirm, toast } = useUI()
  const { patchLesson, deleteLesson, projectName } = useLibrary()
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-6 py-3 lg:px-8">
      <div className="min-w-0 flex-1">
        {current ? (
          <>
            <Link to={`/library/${current.project_id}`} className="text-[12px] text-muted hover:text-fg">
              {projectName(current.project_id ?? 'proj_inbox')}
            </Link>
            <h1 className="truncate text-[17px] font-semibold tracking-[-0.01em]">{current.title}</h1>
          </>
        ) : (
          <SkeletonText lines={2} className="w-64" />
        )}
      </div>
      {current && (
        <div className="flex items-center gap-1.5">
          <Segmented
            size="sm"
            value={current.status ?? 'in_progress'}
            onChange={(s: LessonStatus) => patchLesson(lessonId, { status: s }).catch((e) => toast(e.message, 'error'))}
            options={(['in_progress', 'to_review', 'completed'] as const).map((s) => ({ value: s, label: t(`status.${s}`) }))}
          />
          <span className="mx-1 h-5 w-px bg-line" />
          <IconButton icon={Pencil} size="sm" label={t('lesson.edit')} onClick={() => meta && openModal((close) => <LessonEditModal lesson={meta} close={close} />)} />
          {meta && <MoveLessonButton lesson={meta} />}
          <IconButton icon={RefreshCw} size="sm" label={t('lesson.regenerate')} disabled={!current.has_transcription} onClick={onRegenerate} />
          <IconButton icon={FolderOutput} size="sm" label={t('files.export')} onClick={() => meta && openModal((close) => <ExportModal lesson={meta} close={close} />)} />
          <IconButton
            icon={Trash2}
            size="sm"
            label={t('lesson.delete')}
            onClick={async () => {
              if (await confirm({ title: `${t('lesson.delete')}: ${current.title}`, text: t('lesson.deleteText'), danger: true, confirmLabel: t('common.delete') })) {
                await deleteLesson(lessonId)
                navigate(`/library/${current.project_id}`)
              }
            }}
          />
        </div>
      )}
    </header>
  )
}
