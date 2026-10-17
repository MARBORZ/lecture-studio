import { useState } from 'react'
import { api } from '@/api/client'
import type { AIProvider, LessonFull } from '@/api/types'
import { KeyNotice, useProviderOptions } from '@/features/system/KeyNotice'
import { useUI } from '@/app/AppProvider'
import { Button, Field, Modal, Segmented, Select } from '@/components/ui'
import { VIDEO_TOKENS_PER_HOUR } from '@/features/jobs/PipelineOptionsFields'
import { formatCount } from '@/lib/format'
import { isLang } from './LessonNotices'

/** Regenerate the audit: model, source — the transcript, or (Gemini) the lesson's video — and the language. */
export function RegenerateAuditModal({ lesson, language: initial, close }: { lesson: LessonFull; language?: 'ru' | 'en'; close: () => void }) {
  const { t, settings, toast, lang } = useUI()
  const [language, setLanguage] = useState<'ru' | 'en'>(initial ?? (isLang(lesson.audit_language) ? lesson.audit_language : lang))
  const [provider, setProvider] = useState<AIProvider>(settings?.ai.assistant_provider ?? 'deepseek')
  const providerOptions = useProviderOptions()
  const [source, setSource] = useState<'transcript' | 'video'>(lesson.has_transcription ? 'transcript' : 'video')
  const [busy, setBusy] = useState(false)
  const canVideo = provider === 'gemini' && Boolean(lesson.video_url)
  const effective = source === 'video' && !canVideo ? 'transcript' : source
  return (
    <Modal
      title={t('lesson.regenerate')}
      description={t('lesson.regenerateText')}
      width="sm"
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={effective === 'transcript' && !lesson.has_transcription}
            onClick={async () => {
              setBusy(true)
              try {
                await api.regenerateAudit(lesson.id, provider, settings?.pipeline.audit_mode, effective, language)
                toast(t('lesson.regenerateStarted'))
                close()
              } catch (e) {
                toast((e as Error).message, 'error')
                setBusy(false)
              }
            }}
          >
            {t('lesson.regenerate')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Select value={provider} onChange={setProvider} options={providerOptions} />
        <KeyNotice provider={provider} />
        <Field label={t('lesson.auditSource')} hint={effective === 'video' ? t('opt.auditSource.video.cost', { tokens: formatCount(VIDEO_TOKENS_PER_HOUR, lang) }) : undefined}>
          <Segmented
            value={effective}
            onChange={setSource}
            options={[
              { value: 'transcript', label: t('opt.auditSource.transcript') },
              ...(canVideo ? [{ value: 'video' as const, label: t('opt.auditSource.video') }] : []),
            ]}
          />
        </Field>
        <Field label={t('lesson.auditLanguage')}>
          <Segmented value={language} onChange={setLanguage} options={(['ru', 'en'] as const).map((l) => ({ value: l, label: t(`lang.name.${l}`) }))} />
        </Field>
      </div>
    </Modal>
  )
}
