import { AlertTriangle, FolderSearch, Languages, RefreshCw, X } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/api/client'
import type { LessonFull } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Button, IconButton } from '@/components/ui'
import { storage } from '@/lib/format'

/** Eco: the recording is no longer at its path. Point the lesson at it again (the server checks it is the same one). */
export function SourceMissing({ lessonId, onRelinked }: { lessonId: string; onRelinked: () => Promise<void> }) {
  const { t, promptText, toast } = useUI()
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-fg px-6 py-3 lg:px-8">
      <Icon as={AlertTriangle} size={16} className="shrink-0" />
      <div className="min-w-[14rem] flex-1">
        <p className="text-[13.5px] font-medium text-fg">{t('lesson.sourceMissing')}</p>
        <p className="text-[12.5px] text-muted">{t('lesson.sourceMissingHint')}</p>
      </div>
      <Button
        size="sm"
        variant="primary"
        icon={FolderSearch}
        onClick={async () => {
          const path = await promptText({ title: t('lesson.relink'), label: t('lesson.relinkLabel'), maxLength: 1000 })
          if (!path) return
          try {
            await api.relink(lessonId, path)
            toast(t('lesson.relinked'))
            await onRelinked()
          } catch (e) {
            toast((e as Error).message, 'error')
          }
        }}
      >
        {t('lesson.relink')}
      </Button>
    </div>
  )
}

export const isLang = (v: string): v is 'ru' | 'en' => v === 'ru' || v === 'en'

/**
 * The audit came out in a language other than the recording's (e.g. an English lecture, a Russian interface).
 * Offer to rebuild it in the recording language; dismissing it is remembered per lesson.
 */
export function LanguageMismatch({ lesson, onRegenerate }: { lesson: LessonFull; onRegenerate: (language: 'ru' | 'en') => void }) {
  const { t } = useUI()
  const key = `lesson.langNotice.${lesson.id}.${lesson.audit_language}`
  const [dismissed, setDismissed] = useState(() => storage.get(key, false))
  const { speech_language: speech, audit_language: audit } = lesson
  if (dismissed || !isLang(speech) || !isLang(audit) || speech === audit || !lesson.has_transcription) return null
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-6 py-3 lg:px-8">
      <Icon as={Languages} size={16} className="shrink-0 text-muted" />
      <div className="min-w-[14rem] flex-1">
        <p className="text-[13.5px] text-fg">{t('lesson.languageMismatch', { audit: t(`lang.name.${audit}`), speech: t(`lang.name.${speech}`) })}</p>
        <p className="text-[12.5px] text-muted">{t('lesson.languageMismatchHint')}</p>
      </div>
      <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => onRegenerate(speech)}>
        {t('lesson.regenerateIn', { language: t(`lang.name.${speech}`) })}
      </Button>
      <IconButton
        icon={X}
        size="sm"
        label={t('common.close')}
        onClick={() => {
          storage.set(key, true)
          setDismissed(true)
        }}
      />
    </div>
  )
}
