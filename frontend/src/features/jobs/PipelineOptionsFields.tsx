import { Check, ChevronDown, Info, Leaf } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { PipelineDefaults } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { AnimatePresence, m } from '@/components/motion'
import { Button, Field, Input, Segmented, Select, Slider, Switch } from '@/components/ui'
import type { TKey } from '@/i18n'
import { cn } from '@/lib/cn'
import { formatCount } from '@/lib/format'
import { collapse } from '@/lib/motion'
import { useProviderOptions } from '@/features/system/KeyNotice'

export type Opts = Required<PipelineDefaults>
type Video = Opts['video']
type T = ReturnType<typeof useUI>['t']

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

/** Presets set the media steps only; the notes (who writes, language, format) and fine-tuning stay as they are. */
const PRESETS = {
  standard: { cut_silence: true, video: 'clean', transcriber: 'whisper' },
  eco: { cut_silence: false, video: 'original', transcriber: 'whisper' },
  audio: { cut_silence: true, video: 'none', transcriber: 'whisper' },
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

/** "clean audio · video without pauses · transcript · audit": what the lesson will have. */
export function resultLine(o: Opts, t: T): string {
  const parts = [o.video === 'original' ? t('studio.res.original') : o.cut_silence ? t('studio.res.audio') : t('studio.res.audioFull')]
  if (o.video === 'clean') parts.push(t('studio.res.video'))
  if (o.video === 'compressed') parts.push(t('studio.res.videoCompressed'))
  if (o.transcriber !== 'none') parts.push(t('studio.res.transcript'))
  if (o.audit !== 'none') parts.push(o.audit_source === 'video' ? t('studio.res.auditVideo') : t('studio.res.audit'))
  return parts.join(' · ')
}

/**
 * How a recording is processed. One form for the Studio (per job) and Settings → Processing (defaults), in three levels:
 *   1. the preset (Standard / Eco / Sound only) and one line of what the lesson will have;
 *   2. the notes: who writes them, in which language and format (and, with Gemini, from the video);
 *   3. "Set up by hand" (opens by itself for a custom set): pauses, video, recognition, then fine-tuning.
 * Plain words on the first levels; thresholds and codec settings only in fine-tuning. `source` adapts the Eco note.
 */
export function PipelineOptionsFields({ value, onChange, source }: { value: Opts; onChange: (v: Opts) => void; source?: 'upload' | 'path' }) {
  const { t, lang } = useUI()
  const providers = useProviderOptions()
  const [manualOpen, setManualOpen] = useState(false)
  const [fine, setFine] = useState(false)
  const set = <K extends keyof Opts>(key: K, v: Opts[K]) => onChange(normalize({ ...value, [key]: v }))
  const preset = presetOf(value)
  const manual = manualOpen || preset === 'custom'
  const canWatch = value.audit === 'gemini' && value.video !== 'none'

  return (
    <div className="flex flex-col gap-7">
      {/* 1. the main decision */}
      <section className="flex flex-col gap-3">
        <Heading>{t('opt.how')}</Heading>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChange(normalize({ ...value, ...PRESETS[p] } as Opts))}
              aria-pressed={preset === p}
              className={cn('flex flex-col gap-1 rounded-xl border p-3.5 text-left transition-colors', preset === p ? 'border-fg bg-raised' : 'border-line hover:border-line-strong')}
            >
              <span className="flex items-center gap-2 text-[14px] font-medium text-fg">
                {p === 'eco' && <Icon as={Leaf} size={14} />}
                {t(`opt.preset.${p}`)}
                {preset === p && <Icon as={Check} size={14} className="ml-auto" />}
              </span>
              <span className="text-[12.5px] leading-snug text-muted">{t(`opt.preset.${p}.hint`)}</span>
            </button>
          ))}
        </div>
        <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
          {preset === 'custom' && <span className="rounded-md border border-line-strong px-1.5 py-px text-[11.5px] text-soft">{t('opt.preset.custom')}</span>}
          <span className="text-muted">{t('opt.result')}</span>
          <span className="text-fg">{resultLine(value, t)}</span>
        </p>
      </section>

      {/* 2. the notes */}
      <section className="flex flex-col gap-3">
        <Heading>{t('opt.notes')}</Heading>
        <Segmented value={value.audit} onChange={(v) => set('audit', v)} options={[...providers, { value: 'none', label: t('opt.notes.none') }]} />
        <Hint>{t(`opt.notes.hint.${value.audit}` as TKey)}</Hint>
        {value.transcriber === 'none' && value.audit === 'none' && <Hint>{t('opt.audit.needsText')}</Hint>}
        {value.audit !== 'none' && (
          <div className="flex flex-col gap-4 rounded-xl border border-line p-4">
            <div className="flex flex-wrap gap-x-8 gap-y-4">
              <OutputLanguage value={value} onChange={(v) => set('output_language', v)} />
              <Field label={t('opt.auditMode')}>
                <Segmented
                  value={value.audit_mode}
                  onChange={(v) => set('audit_mode', v)}
                  options={(['srt_timecodes', 'clean_summary'] as const).map((md) => ({ value: md, label: t(`opt.auditMode.${md}`) }))}
                />
              </Field>
            </div>
            {canWatch && (
              <Switch
                checked={value.audit_source === 'video'}
                onChange={(on) => set('audit_source', on ? 'video' : 'transcript')}
                label={t('opt.notes.byVideo')}
                hint={t('opt.notes.byVideo.hint', { tokens: formatCount(VIDEO_TOKENS_PER_HOUR, lang) })}
              />
            )}
          </div>
        )}
      </section>

      {/* 3. by hand */}
      <section className="rounded-xl border border-line">
        <button
          type="button"
          onClick={() => setManualOpen((v) => !v)}
          disabled={preset === 'custom'}
          aria-expanded={manual}
          className="flex w-full items-center gap-3 px-4 py-3 text-left disabled:cursor-default"
        >
          <span className="flex-1">
            <span className="block text-[13.5px] font-medium text-fg">{t('opt.manual')}</span>
            <span className="block text-[12px] text-muted">{t('opt.manual.hint')}</span>
          </span>
          {preset !== 'custom' && <Icon as={ChevronDown} size={15} className={cn('text-muted transition-transform', manual && 'rotate-180')} />}
        </button>
        <AnimatePresence initial={false}>
          {manual && (
            <m.div key="manual" variants={collapse} initial="hidden" animate="show" exit="exit" className="overflow-hidden">
              <div className="flex flex-col divide-y divide-line border-t border-line">
                <Row title={t('opt.step.silence')}>
                  {value.video === 'original' ? (
                    <Hint>{t('opt.cutSilence.original')}</Hint>
                  ) : (
                    <Switch checked={value.cut_silence} onChange={(v) => set('cut_silence', v)} label={t('opt.cutSilence')} hint={t('opt.cutSilence.hint')} />
                  )}
                </Row>
                <Row title={t('opt.step.video')}>
                  <Segmented
                    value={value.video}
                    // "without pauses" turns pause cutting on itself: nothing to disable
                    onChange={(v: Video) => onChange(normalize({ ...value, video: v, ...(v === 'clean' ? { cut_silence: true } : {}) }))}
                    options={(['clean', 'compressed', 'original', 'none'] as Video[]).map((v) => ({ value: v, label: t(`opt.videoShort.${v}`) }))}
                  />
                  <Hint>{t(`opt.video.${value.video}.hint`)}</Hint>
                  {value.video === 'original' && <Hint icon>{source === 'upload' ? t('opt.video.original.upload') : t('opt.video.original.path')}</Hint>}
                </Row>
                <Row title={t('opt.step.transcribe')}>
                  <Segmented
                    value={value.transcriber}
                    onChange={(v) => set('transcriber', v)}
                    options={[
                      { value: 'whisper', label: t('opt.transcriber.whisper') },
                      { value: 'gemini', label: 'Gemini' },
                      { value: 'none', label: t('opt.transcriber.none') },
                    ]}
                  />
                  <Hint>{t(`opt.transcriber.${value.transcriber}.hint`)}</Hint>
                </Row>
                <div>
                  <button type="button" onClick={() => setFine((v) => !v)} aria-expanded={fine} className="flex w-full items-center justify-between px-4 py-3 text-left text-[13px] text-soft hover:text-fg">
                    {t('opt.fine')}
                    <Icon as={ChevronDown} size={15} className={cn('transition-transform', fine && 'rotate-180')} />
                  </button>
                  <AnimatePresence initial={false}>
                    {fine && (
                      <m.div key="fine" variants={collapse} initial="hidden" animate="show" exit="exit" className="overflow-hidden">
                        <FineTuning value={value} set={set} />
                      </m.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </m.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  )
}

/** Thresholds, codec and language settings: the technical words live here only. */
function FineTuning({ value, set }: { value: Opts; set: <K extends keyof Opts>(key: K, v: Opts[K]) => void }) {
  const { t } = useUI()
  const media = value.video === 'clean' || value.video === 'compressed'
  return (
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
      {media && (
        <>
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
        </>
      )}
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
    <Field label={t('opt.outputLanguage')}>
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

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="text-[14px] font-semibold text-fg">{children}</h3>
}

/** A setting under "Set up by hand": its name on the left, the control and one line of explanation on the right. */
function Row({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 px-4 py-4 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <span className="pt-1.5 text-[13px] font-medium text-soft">{title}</span>
      <div className="flex min-w-0 flex-col gap-2">{children}</div>
    </div>
  )
}

/** One line of plain explanation; `icon` for the one that warns (Eco and where the file stays). */
function Hint({ children, icon }: { children: ReactNode; icon?: boolean }) {
  return (
    <p className={cn('flex gap-1.5 text-[12.5px] leading-relaxed', icon ? 'text-soft' : 'text-muted')}>
      {icon && <Icon as={Info} size={13} className="mt-[3px] shrink-0" />}
      <span>{children}</span>
    </p>
  )
}
