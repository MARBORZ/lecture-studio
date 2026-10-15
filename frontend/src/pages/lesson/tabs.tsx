import { AudioLines, Download, FileText, FolderOutput, RefreshCw, ScrollText } from 'lucide-react'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '@/api/client'
import { useLibrary, useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Button, EmptyState, Segmented } from '@/components/ui'
import { useAiKeys } from '@/features/system/KeyNotice'
import { AssistantPanel, type AskState } from '@/features/assistant/AssistantPanel'
import { SelectionAsk } from '@/features/assistant/SelectionAsk'
import { ExportModal } from '@/features/library/modals'
import { MarkdownView } from '@/features/markdown/MarkdownView'
import { Outline } from '@/features/markdown/Outline'
import { TranscriptView } from '@/features/transcript/TranscriptView'
import { useLesson } from './LessonLayout'

export function LessonNotes() {
  const { lesson, regenerate } = useLesson()
  const { t } = useUI()
  const navigate = useNavigate()
  const ref = useRef<HTMLDivElement>(null)

  if (!lesson.lesson_audit_md) {
    return (
      <EmptyState
        icon={FileText}
        title={t('lesson.noAudit')}
        hint={t('lesson.noAuditHint')}
        action={lesson.has_transcription && <Button variant="primary" icon={RefreshCw} onClick={regenerate}>{t('lesson.createAudit')}</Button>}
      />
    )
  }
  return (
    <div className="scroll-area flex-1">
      <div className="flex gap-10 px-6 py-8 lg:px-10">
        <div ref={ref} className="min-w-0 flex-1">
          <SelectionAsk onAsk={(quote) => navigate('../assistant', { relative: 'path', state: { quote } satisfies AskState })}>
            <MarkdownView content={lesson.lesson_audit_md} />
          </SelectionAsk>
        </div>
        <aside className="sticky top-8 hidden w-56 shrink-0 self-start 2xl:block">
          <Outline containerRef={ref} deps={lesson.lesson_audit_md} />
        </aside>
      </div>
    </div>
  )
}

export function LessonTranscript() {
  const { lesson } = useLesson()
  const { t } = useUI()
  if (!lesson.segments?.length) return <EmptyState icon={ScrollText} title={t('lesson.noTranscript')} hint={t('lesson.noTranscriptHint')} action={lesson.audio_url && <TranscribeAction lessonId={lesson.id} />} />
  return (
    <div className="flex min-h-0 flex-1 flex-col px-6 pt-5 pb-3 lg:px-8">
      <TranscriptView segments={lesson.segments} />
    </div>
  )
}

/** Recognize speech again from the lesson's clean audio: the media is kept, only text (and the audit) is made. */
function TranscribeAction({ lessonId }: { lessonId: string }) {
  const { t, toast } = useUI()
  const keys = useAiKeys()
  const [engine, setEngine] = useState<'whisper' | 'gemini'>('whisper')
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex flex-col items-center gap-3">
      <Segmented size="sm" value={engine} onChange={setEngine} options={[{ value: 'whisper', label: t('lesson.engine.whisper') }, { value: 'gemini', label: 'Gemini' }]} />
      <Button
        variant="primary"
        icon={AudioLines}
        loading={busy}
        disabled={engine === 'gemini' && !keys.gemini}
        onClick={async () => {
          setBusy(true)
          try {
            await api.transcribe(lessonId, engine)
            toast(t('lesson.transcribeStarted'))
          } catch (e) {
            toast((e as Error).message, 'error')
          } finally {
            setBusy(false)
          }
        }}
      >
        {t('lesson.transcribe')}
      </Button>
    </div>
  )
}

export function LessonAssistant() {
  const { lesson } = useLesson()
  return (
    <div className="flex min-h-0 flex-1 flex-col px-6 pt-5 pb-4 lg:px-8">
      <AssistantPanel kind="lesson" id={lesson.id} lessonId={lesson.id} />
    </div>
  )
}

const FILES = ['video', 'audio', 'audit', 'srt', 'orig_srt', 'clean_ts', 'txt', 'segments', 'time_map'] as const

export function LessonFiles() {
  const { lesson } = useLesson()
  const { t, openModal } = useUI()
  const { lessons } = useLibrary()
  const meta = lessons.find((l) => l.id === lesson.id)
  const available: Record<(typeof FILES)[number], boolean> = {
    video: Boolean(lesson.video_url),
    audio: Boolean(lesson.audio_url),
    audit: Boolean(lesson.lesson_audit_md),
    srt: Boolean(lesson.segments?.length),
    orig_srt: Boolean(lesson.segments?.length),
    clean_ts: Boolean(lesson.segments?.length),
    txt: Boolean(lesson.plain_text),
    segments: Boolean(lesson.segments?.length),
    time_map: Boolean(lesson.time_map?.length),
  }

  return (
    <div className="scroll-area flex-1">
      <div className="flex max-w-2xl flex-col gap-8 px-6 py-8 lg:px-10">
        <section>
          <div className="label-caps mb-3">{t('files.downloads')}</div>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {FILES.filter((f) => available[f]).map((f) => (
              <li key={f}>
                <a href={api.fileUrl(lesson.id, f)} download className="flex items-center justify-between gap-3 px-4 py-3 text-[13.5px] text-soft transition-colors hover:bg-surface hover:text-fg">
                  {t(`files.${f}`)}
                  <Icon as={Download} size={15} className="text-dim" />
                </a>
              </li>
            ))}
          </ul>
        </section>
        <section className="flex flex-col items-start gap-3">
          <div className="label-caps">{t('files.export')}</div>
          <p className="text-[13px] text-muted">{t('files.exportHint')}</p>
          <Button variant="primary" icon={FolderOutput} onClick={() => meta && openModal((close) => <ExportModal lesson={meta} close={close} />)}>
            {t('files.export')}
          </Button>
        </section>
      </div>
    </div>
  )
}
