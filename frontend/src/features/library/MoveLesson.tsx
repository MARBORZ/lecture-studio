import { Check, FolderInput } from 'lucide-react'
import { useCallback } from 'react'
import type { Lesson } from '@/api/types'
import { useLibrary, useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { IconButton, MenuItem, Modal } from '@/components/ui'
import { cn } from '@/lib/cn'
import { NotebookCover } from './NotebookCover'

/** dataTransfer type of a dragged lesson row; sidebar notebooks accept it. */
export const LESSON_DRAG = 'application/x-lecture-lesson'

/** Move a lesson to another notebook. Files stay where they are: a lesson only changes its notebook. */
export function useMoveLesson() {
  const { t, toast } = useUI()
  const { lessons, patchLesson, projectName } = useLibrary()
  return useCallback(
    async (lessonId: string, projectId: string) => {
      if (lessons.find((l) => l.id === lessonId)?.project_id === projectId) return
      try {
        await patchLesson(lessonId, { project_id: projectId })
        toast(t('lesson.moved', { notebook: projectName(projectId) }))
      } catch (e) {
        toast((e as Error).message, 'error')
      }
    },
    [lessons, patchLesson, projectName, t, toast],
  )
}

/** "Move to notebook": one click on a notebook moves the lesson. A dialog, so no list or header clips it. */
function MoveLessonModal({ lesson, close }: { lesson: Pick<Lesson, 'id' | 'project_id' | 'title'>; close: () => void }) {
  const { t } = useUI()
  const { projects, projectName } = useLibrary()
  const move = useMoveLesson()
  return (
    <Modal title={t('lesson.moveTo')} description={lesson.title} width="sm" onClose={close}>
      <div className="-mx-1.5 flex flex-col">
        {projects.map((p) => {
          const here = p.id === lesson.project_id
          return (
            <MenuItem
              key={p.id}
              active={here}
              disabled={here}
              onClick={() => {
                close()
                void move(lesson.id, p.id)
              }}
            >
              <NotebookCover project={p} active={here} className="size-[18px] text-[10px]" />
              <span className="min-w-0 flex-1 truncate">{projectName(p.id) || p.name}</span>
              <span className="font-mono text-[11px] text-dim">{p.lesson_count ?? 0}</span>
              <Icon as={Check} size={14} className={cn(!here && 'invisible')} />
            </MenuItem>
          )
        })}
      </div>
    </Modal>
  )
}

/** The button that opens it; works inside a row link (does not follow the link). */
export function MoveLessonButton({ lesson, className }: { lesson: Pick<Lesson, 'id' | 'project_id' | 'title'>; className?: string }) {
  const { t, openModal } = useUI()
  return (
    <IconButton
      icon={FolderInput}
      size="sm"
      label={t('lesson.moveTo')}
      className={className}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        openModal((close) => <MoveLessonModal lesson={lesson} close={close} />)
      }}
    />
  )
}
