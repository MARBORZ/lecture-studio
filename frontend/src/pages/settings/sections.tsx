import { Check, ChevronRight, Cpu, FolderInput, GraduationCap, RotateCcw, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { ComputeSettings, PathCheckResult, PipelineDefaults, PromptView, ProviderInfo, UILanguage } from '@/api/types'
import { useLibrary, useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { AnimatePresence, m } from '@/components/motion'
import { Button, Card, Field, Input, Modal, Segmented, Select, Slider, Switch, Textarea } from '@/components/ui'
import { SkeletonCard } from '@/components/skeleton'
import { FALLBACK_DEFAULTS, PipelineOptionsFields } from '@/features/jobs/PipelineOptionsFields'
import { QueueLimitCard } from '@/features/jobs/QueueLimitCard'
import { KeyField } from '@/features/system/KeyField'
import { cn } from '@/lib/cn'
import { collapse } from '@/lib/motion'
import { formatCount } from '@/lib/format'
import type { TKey } from '@/i18n'
import { useResource } from '@/lib/useResource'
import { UninstallCard } from '@/features/system/Uninstall'
import { UpdateCard } from '@/features/system/Update'
import { previewTextScale, type ThemeSetting } from '@/lib/appearance'

function PathRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-2">
      <span className="text-[12px] text-muted">{label}</span>
      <code className="font-mono text-[12.5px] break-all text-soft">{value}</code>
    </div>
  )
}

// ---------------------------------------------------------------- paths

export function PathsSettings() {
  const { t, settings, patchSettings, toast, openModal } = useUI()
  const p = settings!.paths
  const [saved, setSaved] = useState(p.export_dir)
  const [exportDir, setExportDir] = useState(p.export_dir)
  if (saved !== p.export_dir) {
    setSaved(p.export_dir)
    setExportDir(p.export_dir)
  }

  return (
    <div className="flex flex-col gap-6">
      <Card
        title={t('settings.dataDir')}
        description={t('settings.dataDirHint')}
        actions={<Button size="sm" icon={FolderInput} onClick={() => openModal((close) => <DataDirModal close={close} />)}>{t('settings.changeDataDir')}</Button>}
      >
        <code className="block font-mono text-[13px] break-all text-fg">{p.data_dir}</code>
      </Card>

      <Card title={t('settings.exportDir')} description={t('settings.exportDirHint')}>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            await patchSettings({ export_dir: exportDir }).then(() => toast(t('common.saved')), (err) => toast(err.message, 'error'))
          }}
        >
          <Input value={exportDir} onChange={(e) => setExportDir(e.target.value)} placeholder="/Users/…/Obsidian/Course" className="font-mono text-[12.5px]" />
          <Button type="submit" variant="primary" disabled={exportDir === p.export_dir}>{t('common.save')}</Button>
        </form>
      </Card>

      <Card title={t('settings.system')}>
        <div className="divide-y divide-line">
          <PathRow label="notebook_db.json" value={p.db_file} />
          <PathRow label="output/" value={p.output_dir} />
          <PathRow label="temp/" value={p.temp_dir} />
          <PathRow label={t('settings.appHome')} value={p.app_home} />
          <PathRow label="logs/" value={p.logs_dir} />
        </div>
      </Card>
    </div>
  )
}

function DataDirModal({ close }: { close: () => void }) {
  const { t, replaceSettings, toast } = useUI()
  const { refresh } = useLibrary()
  const [path, setPath] = useState('')
  const [check, setCheck] = useState<PathCheckResult | null>(null)
  const [mode, setMode] = useState<'attach' | 'move'>('attach')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!path.trim()) return
    const id = setTimeout(() => void api.checkPath(path).then(setCheck).catch(() => setCheck(null)), 350)
    return () => clearTimeout(id)
  }, [path])

  const valid = Boolean(check && !check.error && !(mode === 'move' && check.has_library))

  return (
    <Modal
      title={t('settings.changeDataDir')}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!valid}
            onClick={async () => {
              setBusy(true)
              try {
                replaceSettings(await api.changeDataDir(path, mode))
                await refresh()
                toast(t('common.saved'))
                close()
              } catch (e) {
                toast((e as Error).message, 'error')
              } finally {
                setBusy(false)
              }
            }}
          >
            {mode === 'move' ? t('settings.move') : t('settings.attach')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label={t('settings.newPath')}
          error={check?.error}
          hint={
            check && !check.error
              ? check.has_library
                ? `${t('settings.pathHasLibrary')}: ${check.lesson_count}`
                : check.exists
                  ? t('settings.pathOk')
                  : t('settings.pathNew')
              : undefined
          }
        >
          <Input
            value={path}
            onChange={(e) => {
              setPath(e.target.value)
              setCheck(null)
            }}
            placeholder="/Users/…/LectureStudioData" className="font-mono text-[12.5px]" />
        </Field>
        <div className="grid gap-2 sm:grid-cols-2">
          {(['attach', 'move'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn('flex flex-col gap-1 rounded-xl border p-3 text-left', mode === m ? 'border-fg' : 'border-line hover:border-line-strong')}
            >
              <span className="flex items-center gap-2 text-[13.5px] font-medium">
                {mode === m && <Icon as={Check} size={14} />}
                {t(m === 'move' ? 'settings.move' : 'settings.attach')}
              </span>
              <span className="text-[12px] leading-snug text-muted">{t(m === 'move' ? 'settings.moveHint' : 'settings.attachHint')}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- AI

export function AISettingsSection() {
  const { t, settings, patchSettings, toast } = useUI()
  const providers = useResource(() => api.providers(), [])
  const ai = settings!.ai
  const models = (cat: string) => (providers.data?.[cat]?.supported_models ?? []).map((m) => ({ value: m, label: m }))
  const patch = (p: Record<string, string>) => patchSettings({ ai: p }).catch((e) => toast(e.message, 'error'))

  return (
    <div className="flex flex-col gap-6">
      <Card title={t('settings.keys')} description={t('settings.keysHint')}>
        <div className="flex flex-col gap-6">
          <KeyField provider="deepseek" />
          <KeyField provider="gemini" />
        </div>
      </Card>
      <ComputeCard />
      <Card title={t('settings.models')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="DeepSeek">
            <Select value={ai.deepseek_model} onChange={(v) => patch({ deepseek_model: v })} options={models('deepseek').length ? models('deepseek') : [{ value: ai.deepseek_model, label: ai.deepseek_model }]} />
          </Field>
          <Field label="Gemini">
            <Select value={ai.gemini_model} onChange={(v) => patch({ gemini_model: v })} options={models('gemini').length ? models('gemini') : [{ value: ai.gemini_model, label: ai.gemini_model }]} />
          </Field>
          <Field label={t('settings.whisperModel')}>
            <Select value={ai.whisper_model} onChange={(v) => patch({ whisper_model: v })} options={['large-v3-turbo', 'large-v3', 'medium', 'small'].map((m) => ({ value: m, label: m }))} />
          </Field>
          <Field label={t('settings.assistantProvider')}>
            <Segmented value={ai.assistant_provider} onChange={(v) => patch({ assistant_provider: v })} options={[{ value: 'deepseek', label: 'DeepSeek' }, { value: 'gemini', label: 'Gemini' }]} />
          </Field>
        </div>
      </Card>
      {providers.data && <ContextWindowCard providers={providers.data} />}
    </div>
  )
}

const CONTEXT_PROVIDERS = [
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'gemini', label: 'Gemini' },
] as const
const CHARS_PER_PAGE = 1800 // a typewritten page

/** The assistant's window per provider, in tokens, within the model's limit. Saved on release, like the text size. */
function ContextWindowCard({ providers }: { providers: Record<string, ProviderInfo> }) {
  const { t, lang, settings, patchSettings, toast } = useUI()
  const stored = settings!.ai.context_tokens
  const [draft, setDraft] = useState<{ id: string; tokens: number } | null>(null)
  const save = (id: string, tokens: number | null) =>
    patchSettings({ ai: { context_tokens: { [id]: tokens } } }).catch((e: Error) => toast(e.message, 'error'))
  const n = (v: number) => formatCount(v, lang)

  return (
    <Card title={t('settings.contextWindow')} description={t('settings.contextWindowHint')}>
      <div className="flex flex-col gap-6">
        {CONTEXT_PROVIDERS.map(({ id, label }) => {
          const p = providers[id]
          if (!p) return null
          const step = p.max_context_tokens > 200_000 ? 50_000 : 8_000
          const saved = stored[id as keyof typeof stored] ?? p.default_context_tokens
          const value = draft?.id === id ? draft.tokens : saved
          const chars = value * p.chars_per_token
          const presets = [...new Set([p.default_context_tokens / 2, p.default_context_tokens, p.max_context_tokens])]
          const commit = () => {
            if (draft?.id === id && draft.tokens !== saved) void save(id, draft.tokens)
            setDraft(null)
          }
          return (
            <div key={id} className="flex flex-col gap-2.5" onPointerUp={commit} onKeyUp={commit}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13.5px] text-fg">{label}</span>
                <span className="font-mono text-[12px] text-muted">{t('settings.contextWindow.tokens', { n: n(value) })}</span>
              </div>
              <Slider value={value} min={Math.max(p.min_context_tokens, step)} max={p.max_context_tokens} step={step} onChange={(tokens) => setDraft({ id, tokens })} />
              <span className="text-[12px] text-muted">
                {t('settings.contextWindow.size', { chars: n(chars), pages: n(Math.round(chars / CHARS_PER_PAGE)) })}
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {presets.map((v) => (
                  <Button key={v} size="sm" variant={value === v ? 'primary' : 'secondary'} onClick={() => void save(id, v)}>
                    {v === p.default_context_tokens ? t('settings.contextWindow.default', { n: n(v) }) : n(v)}
                  </Button>
                ))}
                {stored[id as keyof typeof stored] !== undefined && (
                  <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => void save(id, null)}>{t('settings.contextWindow.reset')}</Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- processing

export function ProcessingSettings() {
  const { t, settings, patchSettings, toast } = useUI()
  const [opts, setOpts] = useState<Required<PipelineDefaults>>({ ...FALLBACK_DEFAULTS, ...settings!.pipeline } as Required<PipelineDefaults>)
  const dirty = JSON.stringify(opts) !== JSON.stringify({ ...FALLBACK_DEFAULTS, ...settings!.pipeline })
  return (
    <div className="flex flex-col gap-6">
      <Card
        title={t('settings.pipelineDefaults')}
        actions={
          <Button size="sm" variant="primary" disabled={!dirty} onClick={() => patchSettings({ pipeline: opts }).then(() => toast(t('common.saved')), (e) => toast(e.message, 'error'))}>
            {t('common.save')}
          </Button>
        }
      >
        <PipelineOptionsFields value={opts} onChange={setOpts} />
      </Card>
      <QueueLimitCard />
    </div>
  )
}

/** Where local models (Whisper) run: auto / GPU / CPU, CPU threads, and what the next job will actually use. */
function ComputeCard() {
  const { t, settings, patchSettings, toast } = useUI()
  const c = settings!.compute
  const status = useResource(() => api.compute(), [c.device, c.cpu_threads])
  const s = status.data
  const [threads, setThreads] = useState<number | null>(null)
  const save = (patch: Partial<ComputeSettings>) => patchSettings({ compute: { ...c, ...patch } }).catch((e: Error) => toast(e.message, 'error'))
  const shown = threads ?? (c.cpu_threads || s?.cores || 1)

  return (
    <Card title={t('settings.compute')} description={t('settings.computeHint')}>
      <div className="flex flex-col gap-5">
        <Segmented<ComputeSettings['device']>
          value={c.device}
          onChange={(device) => save({ device })}
          options={[
            { value: 'auto', label: t('settings.compute.auto') },
            { value: 'gpu', label: t('settings.compute.gpu') },
            { value: 'cpu', label: t('settings.compute.cpu') },
          ]}
        />
        {!s ? (
          <p className="animate-pulse-soft text-[13px] text-muted">{t('settings.deviceChecking')}</p>
        ) : (
          <div className="flex items-start gap-3 rounded-lg border border-line px-3.5 py-3">
            <Icon as={s.backend === 'cpu' ? Cpu : Zap} size={18} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-[13.5px] text-fg">
                {s.backend === 'cpu' ? t('settings.compute.onCpu', { n: s.threads }) : t('settings.compute.onGpu', { name: s.gpu_name })}
              </p>
              {s.reason && (
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted" title={s.failure || undefined}>
                  {t(`settings.compute.why.${s.reason as ComputeReason}`, { name: s.gpu_name })}
                </p>
              )}
            </div>
          </div>
        )}
        {s && (
          <Field
            label={t('settings.compute.threads')}
            hint={t('settings.compute.threadsHint', { cores: s.cores, logical: s.logical_cores })}
            aside={c.cpu_threads ? String(shown) : t('settings.compute.threadsAll', { n: s.cores })}
          >
            <div onPointerUp={() => threads !== null && (save({ cpu_threads: threads }), setThreads(null))}>
              <Slider min={1} max={s.logical_cores} step={1} value={shown} onChange={setThreads} />
            </div>
          </Field>
        )}
        {s && c.cpu_threads > 0 && (
          <Button size="sm" variant="ghost" className="self-start" onClick={() => save({ cpu_threads: 0 })}>{t('settings.compute.threadsReset')}</Button>
        )}
      </div>
    </Card>
  )
}

type ComputeReason = 'user' | 'no_gpu' | 'old_gpu' | 'old_driver' | 'torch_cpu' | 'apple_unavailable' | 'gpu_failed'

// ---------------------------------------------------------------- interface

export function InterfaceSettings() {
  const { t, settings, patchSettings, setTutorialOpen } = useUI()
  return (
    <div className="flex flex-col gap-6">
      <Card title={t('settings.language')}>
        <Segmented<UILanguage>
          value={settings!.ui_language}
          onChange={(v) => void patchSettings({ ui_language: v })}
          options={[{ value: 'ru', label: 'Русский' }, { value: 'en', label: 'English' }]}
        />
      </Card>
      <Card title={t('settings.theme')} description={t('settings.themeHint')}>
        <Segmented<ThemeSetting>
          value={settings!.theme}
          onChange={(v) => void patchSettings({ theme: v })}
          options={[
            { value: 'system', label: t('settings.theme.system') },
            { value: 'dark', label: t('settings.theme.dark') },
            { value: 'light', label: t('settings.theme.light') },
          ]}
        />
      </Card>
      <TextSizeCard />
      <Card title={t('settings.bootTitle')}>
        <Switch
          checked={settings!.boot_animation}
          onChange={(on) => void patchSettings({ boot_animation: on })}
          label={t('settings.boot')}
          hint={t('settings.bootHint')}
        />
      </Card>
      <Card title={t('onboarding.replay')} description={t('onboarding.replayHint')}>
        <Button icon={GraduationCap} onClick={() => setTutorialOpen(true)}>{t('onboarding.replay')}</Button>
      </Card>
      <UpdateCard />
      <UninstallCard />
    </div>
  )
}

/** Reading text size: 100% = default; the slider previews live and saves on release. */
function TextSizeCard() {
  const { t, settings, patchSettings } = useUI()
  const saved = settings!.text_scale
  const [draft, setDraft] = useState<number | null>(null)
  const value = draft ?? saved
  const commit = () => {
    if (draft !== null && draft !== saved) void patchSettings({ text_scale: draft })
    setDraft(null)
  }
  return (
    <Card title={t('settings.textSize')} description={t('settings.textSizeHint')}>
      <div className="flex flex-col gap-4" onPointerUp={commit} onKeyUp={commit}>
        <Slider
          value={value}
          min={80}
          max={150}
          step={5}
          format={(v) => `${v}%`}
          onChange={(v) => {
            setDraft(v)
            previewTextScale(v)
          }}
        />
        <div className="flex flex-wrap gap-1.5">
          {[90, 100, 115, 125, 140].map((v) => (
            <Button key={v} size="sm" variant={value === v ? 'primary' : 'secondary'} onClick={() => void patchSettings({ text_scale: v })}>
              {v}%
            </Button>
          ))}
        </div>
        <p className="read-14 rounded-lg border border-line px-4 py-3 leading-relaxed text-soft">{t('settings.textSizeSample')}</p>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- AI instructions

function PromptEditor({ block, onChange }: { block: PromptView; onChange: (all: PromptView[]) => void }) {
  const { t, toast, confirm } = useUI()
  /** Block titles are keyed in i18n; a block added on the backend later still shows its key. */
  const tr = (key: string, fallback: string) => {
    const v = t(key as TKey)
    return v === key ? fallback : v
  }
  const title = tr(`prompt.${block.key}.title`, block.key)
  const hint = tr(`prompt.${block.key}.hint`, '')
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(block.value)
  const [saved, setSaved] = useState(block.value)
  if (saved !== block.value) {
    setSaved(block.value) // server state changed (save/reset): follow it
    setValue(block.value)
  }
  const dirty = value.trim() !== block.value.trim()
  const run = (p: Promise<PromptView[]>) => p.then(onChange).catch((e) => toast(e.message, 'error'))

  return (
    <div className="border-t border-line first:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 py-3 text-left"
      >
        <Icon as={ChevronRight} size={14} className={cn('shrink-0 text-dim transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-fg">{title}</span>
          {hint && <span className="block truncate text-[12px] text-muted">{hint}</span>}
        </span>
        {dirty && <span className="size-1.5 shrink-0 rounded-full bg-fg" aria-label={t('common.unsaved')} />}
        <span className={cn('shrink-0 rounded-md border px-1.5 py-0.5 text-[11px]', block.modified ? 'border-fg text-fg' : 'border-line text-dim')}>
          {block.modified ? t('prompts.modified') : t('prompts.default')}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <m.div key="body" variants={collapse} initial="hidden" animate="show" exit="exit" className="overflow-hidden">
            <div className="flex flex-col gap-2 pb-4 pl-[26px]">
              <Textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                rows={Math.min(18, Math.max(3, value.split('\n').length + 1))}
                className="font-mono text-[12.5px] leading-relaxed"
              />
              <div className="flex justify-end gap-2">
                {block.modified && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={RotateCcw}
                    onClick={async () => {
                      if (await confirm({ title: `${t('prompts.reset')}: ${title}`, text: t('prompts.resetText') })) void run(api.resetPrompt(block.key))
                    }}
                  >
                    {t('prompts.reset')}
                  </Button>
                )}
                <Button size="sm" variant="primary" disabled={!dirty || !value.trim()} onClick={() => run(api.savePrompt(block.key, value)).then(() => toast(t('common.saved')))}>
                  {t('common.save')}
                </Button>
              </div>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function PromptsSettings() {
  const { t } = useUI()
  const blocks = useResource(() => api.prompts(), [])
  if (!blocks.data) return <SkeletonCard />
  return (
    <div className="flex flex-col gap-6">
      <p className="text-[13px] leading-relaxed text-muted">{t('prompts.hint')}</p>
      {(['audit', 'assistant'] as const).map((group) => (
        <Card key={group} title={t(`prompts.group.${group}`)} description={group === 'audit' ? t('prompts.applyHint') : undefined}>
          <div className="flex flex-col">
            {blocks.data!.filter((b) => b.group === group).map((b) => (
              <PromptEditor key={b.key} block={b} onChange={(all) => blocks.setData(all)} />
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}
