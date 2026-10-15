import type { PipelineDefaults } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Field, Input, Segmented, Select, Slider, Switch } from '@/components/ui'

type Opts = Required<PipelineDefaults>

/** One form for processing options. Used by Studio (per job) and Settings (defaults). */
export function PipelineOptionsFields({ value, onChange }: { value: Opts; onChange: (v: Opts) => void }) {
  const { t } = useUI()
  const set = <K extends keyof Opts>(key: K, v: Opts[K]) => onChange({ ...value, [key]: v })
  const transcribes = value.mode !== 'audio_only'

  return (
    <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
      <div className="flex flex-col gap-5">
        <div className="label-caps">Silero VAD</div>
        <Field label={t('opt.silence')} hint={t('opt.silenceHint')} aside={`${value.min_silence_ms} ms`}>
          <Slider min={200} max={3000} step={50} value={value.min_silence_ms} onChange={(v) => set('min_silence_ms', v)} />
        </Field>
        <Field label={t('opt.pad')} hint={t('opt.padHint')} aside={`${value.speech_pad_ms} ms`}>
          <Slider min={0} max={800} step={10} value={value.speech_pad_ms} onChange={(v) => set('speech_pad_ms', v)} />
        </Field>
        <Field label={t('opt.vad')} hint={t('opt.vadHint')} aside={value.vad_threshold.toFixed(2)}>
          <Slider min={0.2} max={0.9} step={0.05} value={value.vad_threshold} onChange={(v) => set('vad_threshold', v)} />
        </Field>
        <Switch checked={value.enhance_audio} onChange={(v) => set('enhance_audio', v)} label={t('opt.enhance')} hint={t('opt.enhanceHint')} />
      </div>

      <div className="flex flex-col gap-5">
        <div className="label-caps">{t('player.video')}</div>
        <Switch checked={value.clean_video} onChange={(v) => set('clean_video', v)} label={t('opt.video')} hint={t('opt.videoHint')} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('opt.resolution')}>
            <Select
              disabled={!value.clean_video}
              value={value.video_resolution}
              onChange={(v) => set('video_resolution', v)}
              options={(['1080p', '720p', 'original'] as const).map((r) => ({ value: r, label: t(`opt.res.${r}`) }))}
            />
          </Field>
          <Field label={t('opt.crf')}>
            <Select
              disabled={!value.clean_video}
              value={String(value.video_crf) as '24' | '26' | '28' | '32'}
              onChange={(v) => set('video_crf', Number(v))}
              options={(['24', '26', '28', '32'] as const).map((c) => ({ value: c, label: t(`opt.crf.${c}`) }))}
            />
          </Field>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <div className="label-caps">{t('lesson.transcript')}</div>
        <Field label={t('opt.mode')}>
          <Select
            value={value.mode}
            onChange={(v) => set('mode', v)}
            options={(['deepseek', 'gemini', 'whisper', 'audio_only'] as const).map((m) => ({ value: m, label: t(`opt.mode.${m}`) }))}
          />
        </Field>
        <Field label={t('opt.language')}>
          <Segmented
            value={(['auto', 'ru', 'en'].includes(value.language) ? value.language : 'auto') as 'auto' | 'ru' | 'en'}
            onChange={(v) => set('language', v)}
            options={[
              { value: 'auto', label: t('opt.language.auto') },
              { value: 'ru', label: 'RU' },
              { value: 'en', label: 'EN' },
            ]}
          />
        </Field>
        <Field label={t('opt.vocabulary')} hint={t('opt.vocabularyHint')}>
          <Input disabled={!transcribes} value={value.custom_vocabulary} onChange={(e) => set('custom_vocabulary', e.target.value)} />
        </Field>
      </div>

      <div className="flex flex-col gap-5">
        <div className="label-caps">{t('lesson.notes')}</div>
        <Switch disabled={!transcribes} checked={value.generate_audit && transcribes} onChange={(v) => set('generate_audit', v)} label={t('opt.audit')} />
        <Field label={t('opt.auditMode')}>
          <Segmented
            value={value.audit_mode}
            onChange={(v) => set('audit_mode', v)}
            options={(['srt_timecodes', 'clean_summary'] as const).map((m) => ({ value: m, label: t(`opt.auditMode.${m}`) }))}
          />
        </Field>
      </div>
    </div>
  )
}

export const FALLBACK_DEFAULTS: Opts = {
  min_silence_ms: 800,
  speech_pad_ms: 250,
  vad_threshold: 0.5,
  enhance_audio: false,
  clean_video: true,
  video_resolution: '1080p',
  video_crf: 26,
  mode: 'deepseek',
  language: 'auto',
  custom_vocabulary: '',
  generate_audit: true,
  audit_mode: 'srt_timecodes',
}
