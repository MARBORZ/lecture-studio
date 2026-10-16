import { AlertTriangle, Check, ChevronDown, Leaf } from 'lucide-react'
import { useState } from 'react'
import type { PipelineDefaults } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { AnimatePresence, m } from '@/components/motion'
import { Button, Field, Input, Segmented, Select, Slider, Switch } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatCount } from '@/lib/format'
import { collapse } from '@/lib/motion'
import { useProviderOptions } from '@/features/system/KeyNotice'

export type Opts = Required<PipelineDefaults>
type Video = Opts['video']

/** ~66 tokens per frame at 1 fps (low resolution) + ~32 for the sound: what Gemini counts for a video. */
export const VIDEO_TOKENS_PER_HOUR = 100 * 3600

export const FALLBACK_DEFAULTS: Opts = {
  cut_silence: true,
  min_silence_ms: 800,
  speech_pad_ms: 250,
  vad_threshold: 0.5,
  enhance_audio: false,
  video: 'clean',
  video_resolution: '1080p',
  video_crf: 26,
  transcriber: 'whisper',
  language: 'auto',
  custom_vocabulary: '',
  audit: 'deepseek',
  audit_source: 'transcript',
  audit_mode: 'srt_timecodes',
  output_language: 'interface',
}

/** Presets set the step choices only; fine-tuning (silence thresholds, quality, language) stays as it is. */
const PRESETS = {
  standard: { cut_silence: true, video: 'clean', transcriber: 'whisper', audit: 'deepseek', audit_source: 'transcript' },
  eco: { cut_silence: false, video: 'original', transcriber: 'whisper', audit: 'deepseek', audit_source: 'transcript' },
  audio: { cut_silence: true, video: 'none', transcriber: 'whisper', audit: 'deepseek', audit_source: 'transcript' },
} as const satisfies Record<string, Partial<Opts>>
type Preset = keyof typeof PRESETS | 'custom'

/**
 * The same consistency rules the server applies (backend/settings/schema.py PipelineDefaults), so the form shows what
 * will actually run. The server stays the source of truth.
 */
export function normalize(o: Opts): Opts {
  const n = { ...o }
  if (n.video === 'original') n.cut_silence = false
  if (n.video === 'clean' && !n.cut_silence) n.video = 'compressed'
  if (n.audit === 'none' || (n.audit_source === 'video' && (n.audit !== 'gemini' || n.video === 'none'))) n.audit_source = 'transcript'
  if (n.transcriber === 'none' && n.audit_source === 'transcript') n.audit = 'none'
  return n
}

function presetOf(o: Opts): Preset {
  const hit = (Object.keys(PRESETS) as (keyof typeof PRESETS)[]).find((k) =>
    Object.entries(PRESETS[k]).every(([key, v]) => o[key as keyof Opts] === v),
  )
  return hit ?? 'custom'
}

/**
 * Every processing step, each switchable: silence cutting, video, transcription, audit. One form for the Studio
 * (per job) and Settings → Processing (defaults). `source` adapts the Eco warning to a path on disk or an upload.
 */
export function PipelineOptionsFields({ value, onChange, source }: { value: Opts; onChange: (v: Opts) => void; source?: 'upload' | 'path' }) {
  const { t, lang } = useUI()
  const providerOptions = useProviderOptions()
  const [fine, setFine] = useState(false)
  const set = <K extends keyof Opts>(key: K, v: Opts[K]) => onChange(normalize({ ...value, [key]: v }))
  const preset = presetOf(value)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="label-caps">{t('opt.preset')}</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChange(normalize({ ...value, ...PRESETS[p] } as Opts))}
              aria-pressed={preset === p}
              className={cn('flex flex-col gap-1 rounded-xl border p-3 text-left transition-colors', preset === p ? 'border-fg bg-raised' : 'border-line hover:border-line-strong')}
            >
              <span className="flex items-center gap-2 text-[13.5px] font-medium text-fg">
                {p === 'eco' && <Icon as={Leaf} size={14} />}
                {t(`opt.preset.${p}`)}
                {preset === p && <Icon as={Check} size={14} className="ml-auto" />}
              </span>
              <span className="text-[12px] leading-snug text-muted">{t(`opt.preset.${p}.hint`)}</span>
            </button>
          ))}
        </div>
        {preset === 'custom' && <p className="text-[12px] text-dim">{t('opt.preset.custom')}</p>}
      </div>

      <Step n={1} title={t('opt.step.silence')}>
        <Switch
          checked={value.cut_silence}
          disabled={value.video === 'original'}
          onChange={(v) => set('cut_silence', v)}
          label={t('opt.cutSilence')}
          hint={value.video === 'original' ? t('opt.cutSilence.original') : t('opt.cutSilence.hint')}
        />
      </Step>

      <Step n={2} title={t('opt.step.video')}>
        <div className="grid gap-2 sm:grid-cols-2">
          {(['clean', 'compressed', 'original', 'none'] as Video[]).map((v) => (
            <Choice
              key={v}
              on={value.video === v}
              disabled={v === 'clean' && !value.cut_silence}
              onClick={() => onChange(normalize({ ...value, video: v, ...(v === 'clean' ? { cut_silence: true } : {}) }))}
              title={t(`opt.video.${v}`)}
              hint={t(`opt.video.${v}.hint`)}
            />
          ))}
        </div>
        {value.video === 'original' && (
          <Note>{source === 'upload' ? t('opt.video.original.upload') : t('opt.video.original.path')}</Note>
        )}
        {(value.video === 'clean' || value.video === 'compressed') && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('opt.resolution')}>
              <Select
                value={value.video_resolution}
                onChange={(v) => set('video_resolution', v)}
                options={(['1080p', '720p', 'original'] as const).map((r) => ({ value: r, label: t(`opt.res.${r}`) }))}
              />
            </Field>
            <Field label={t('opt.crf')}>
              <Select
                value={String(value.video_crf) as '24' | '26' | '28' | '32'}
                onChange={(v) => set('video_crf', Number(v))}
                options={(['24', '26', '28', '32'] as const).map((c) => ({ value: c, label: t(`opt.crf.${c}`) }))}
              />
            </Field>
          </div>
        )}
      </Step>

      <Step n={3} title={t('opt.step.transcribe')}>
        <Segmented
          value={value.transcriber}
          onChange={(v) => set('transcriber', v)}
          options={[
            { value: 'whisper', label: t('opt.transcriber.whisper') },
            { value: 'gemini', label: 'Gemini' },
            { value: 'none', label: t('opt.none') },
          ]}
        />
        <p className="text-[12px] text-muted">{t(`opt.transcriber.${value.transcriber}.hint`)}</p>
      </Step>

      <Step n={4} title={t('opt.step.audit')}>
        <Segmented
          value={value.audit}
          onChange={(v) => set('audit', v)}
          options={[...providerOptions, { value: 'none', label: t('opt.none') }]}
        />
        {value.transcriber === 'none' && value.audit === 'none' && <p className="text-[12px] text-muted">{t('opt.audit.needsText')}</p>}
        {value.audit !== 'none' && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Choice on={value.audit_source === 'transcript'} onClick={() => set('audit_source', 'transcript')} title={t('opt.auditSource.transcript')} hint={t('opt.auditSource.transcript.hint')} />
            <Choice
              on={value.audit_source === 'video'}
              disabled={value.audit !== 'gemini' || value.video === 'none'}
              onClick={() => set('audit_source', 'video')}
              title={t('opt.auditSource.video')}
              hint={value.audit !== 'gemini' ? t('opt.auditSource.video.gemini') : value.video === 'none' ? t('opt.auditSource.video.noVideo') : t('opt.auditSource.video.hint')}
            />
          </div>
        )}
        {value.audit_source === 'video' && <Note>{t('opt.auditSource.video.cost', { tokens: formatCount(VIDEO_TOKENS_PER_HOUR, lang) })}</Note>}
        {value.audit !== 'none' && <OutputLanguage value={value} onChange={(v) => set('output_language', v)} />}
        {value.audit !== 'none' && (
          <Field label={t('opt.auditMode')}>
            <Segmented
              value={value.audit_mode}
              onChange={(v) => set('audit_mode', v)}
              options={(['srt_timecodes', 'clean_summary'] as const).map((m) => ({ value: m, label: t(`opt.auditMode.${m}`) }))}
            />
          </Field>
        )}
      </Step>

      <div className="rounded-xl border border-line">
        <button type="button" onClick={() => setFine((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left text-[13px] text-soft hover:text-fg">
          {t('opt.fine')}
          <Icon as={ChevronDown} size={15} className={cn('transition-transform', fine && 'rotate-180')} />
        </button>
        <AnimatePresence initial={false}>
          {fine && (
            <m.div key="fine" variants={collapse} initial="hidden" animate="show" exit="exit" className="overflow-hidden">
              <div className="grid gap-x-8 gap-y-5 border-t border-line p-4 md:grid-cols-2">
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
                <Field label={t('opt.language')}>
                  <Segmented
                    value={(['auto', 'ru', 'en'].includes(value.language) ? value.language : 'auto') as 'auto' | 'ru' | 'en'}
                    onChange={(v) => set('language', v)}
                    options={[{ value: 'auto', label: t('opt.language.auto') }, { value: 'ru', label: 'RU' }, { value: 'en', label: 'EN' }]}
                  />
                </Field>
                <Field label={t('opt.vocabulary')} hint={t('opt.vocabularyHint')}>
                  <Input disabled={value.transcriber === 'none'} value={value.custom_vocabulary} onChange={(e) => set('custom_vocabulary', e.target.value)} />
                </Field>
              </div>
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

/**
 * Audit language. When the recording language is set explicitly and differs from the interface, the default
 * ("same as interface") is turned into a question — the choice becomes explicit and the question goes away.
 */
function OutputLanguage({ value, onChange }: { value: Opts; onChange: (v: Opts['output_language']) => void }) {
  const { t, lang } = useUI()
  const speech = value.language === 'ru' || value.language === 'en' ? value.language : null
  const mismatch = value.output_language === 'interface' && speech !== null && speech !== lang ? ([lang, speech] as const) : null
  return (
    <Field label={t('opt.outputLanguage')} hint={t('opt.outputLanguage.hint')}>
      <Segmented
        value={value.output_language}
        onChange={onChange}
        options={[
          { value: 'interface', label: t('opt.outputLanguage.interface') },
          { value: 'recording', label: t('opt.outputLanguage.recording') },
          { value: 'ru', label: 'RU' },
          { value: 'en', label: 'EN' },
        ]}
      />
      {mismatch && (
        <div className="mt-2 flex flex-col gap-2 rounded-lg border border-line-strong px-3 py-2.5 text-[12.5px] text-soft">
          {t('opt.outputLanguage.mismatch', { speech: t(`lang.name.${mismatch[1]}`), ui: t(`lang.name.${mismatch[0]}`) })}
          <div className="flex flex-wrap gap-2">
            {mismatch.map((l) => (
              <Button key={l} size="sm" variant="secondary" onClick={() => onChange(l)}>
                {t(`lang.name.${l}`)}
              </Button>
            ))}
          </div>
        </div>
      )}
    </Field>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <span className="flex size-5 items-center justify-center rounded-full border border-line-strong font-mono text-[10.5px] text-muted">{n}</span>
        <span className="text-[13.5px] font-medium text-fg">{title}</span>
      </div>
      <div className="flex flex-col gap-3 pl-7">{children}</div>
    </section>
  )
}

function Choice({ on, disabled, onClick, title, hint }: { on: boolean; disabled?: boolean; onClick: () => void; title: string; hint: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={on}
      className={cn('flex flex-col gap-1 rounded-xl border p-3 text-left transition-colors disabled:opacity-40', on ? 'border-fg bg-raised' : 'border-line hover:border-line-strong')}
    >
      <span className="flex items-center justify-between gap-2 text-[13px] font-medium text-fg">
        {title}
        {on && <Icon as={Check} size={14} />}
      </span>
      <span className="text-[12px] leading-snug text-muted">{hint}</span>
    </button>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2 rounded-lg border border-line-strong px-3 py-2 text-[12.5px] leading-relaxed text-soft">
      <Icon as={AlertTriangle} size={14} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}
