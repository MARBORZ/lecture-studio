import { Cpu, RotateCcw, Zap } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/api/client'
import type { ComputeSettings, ProviderInfo } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Button, Card, Field, Segmented, Select, Slider } from '@/components/ui'
import { KeyField } from '@/features/system/KeyField'
import { McpCard } from '@/features/system/McpCard'
import { CLOUD_PROVIDERS, PROVIDER_NAME, useProviderOptions } from '@/features/system/KeyNotice'
import { LocalModelCard } from '@/features/system/LocalModelCard'
import { formatCount } from '@/lib/format'
import { useResource } from '@/lib/useResource'

/** Settings → AI: Claude (MCP), keys, the local model, compute, models and the assistant's context window. */
export function AISettingsSection() {
  const { t, settings, patchSettings, toast } = useUI()
  const providers = useResource(() => api.providers(), [])
  const ai = settings!.ai
  const providerOptions = useProviderOptions()
  const models = (cat: string) => (providers.data?.[cat]?.supported_models ?? []).map((m) => ({ value: m, label: m }))
  const patch = (p: Record<string, string>) => patchSettings({ ai: p }).catch((e) => toast(e.message, 'error'))

  return (
    <div className="flex flex-col gap-6">
      <McpCard />
      <Card
        title={t('settings.keys')}
        description={t('settings.keysHint')}
        fold="ai.keys"
        summary={CLOUD_PROVIDERS.map((p) => `${PROVIDER_NAME[p]}: ${ai[`${p}_key`].source === 'none' ? t('settings.summary.noKey') : ai[`${p}_key`].hint || t('settings.summary.keySet')}`).join(' · ')}
      >
        <div className="flex flex-col gap-6">
          {CLOUD_PROVIDERS.map((p) => <KeyField key={p} provider={p} />)}
        </div>
      </Card>
      <LocalModelCard />
      <ComputeCard />
      <Card title={t('settings.models')} fold="ai.models" summary={`${CLOUD_PROVIDERS.map((p) => ai[`${p}_model`]).join(' · ')} · Claude Code ${ai.claude_code_model} · Whisper ${ai.whisper_model}`}>
        <div className="grid gap-4 sm:grid-cols-2">
          {CLOUD_PROVIDERS.map((p) => {
            const current = ai[`${p}_model`]
            const list = models(p)
            // a model typed into settings.json (or no longer offered) stays selectable
            const options = list.some((o) => o.value === current) ? list : [{ value: current, label: current }, ...list]
            return (
              <Field key={p} label={PROVIDER_NAME[p]}>
                <Select value={current} onChange={(v) => patch({ [`${p}_model`]: v })} options={options} />
              </Field>
            )
          })}
          <Field label={PROVIDER_NAME.claude_code}>
            <Select
              value={ai.claude_code_model}
              onChange={(v) => patch({ claude_code_model: v })}
              options={(models('claude_code').length ? models('claude_code') : [{ value: ai.claude_code_model, label: ai.claude_code_model }])}
            />
          </Field>
          <Field label={t('settings.whisperModel')}>
            <Select value={ai.whisper_model} onChange={(v) => patch({ whisper_model: v })} options={['large-v3-turbo', 'large-v3', 'medium', 'small'].map((m) => ({ value: m, label: m }))} />
          </Field>
          <Field label={t('settings.assistantProvider')}>
            <Select value={ai.assistant_provider} onChange={(v) => patch({ assistant_provider: v })} options={providerOptions} />
          </Field>
        </div>
      </Card>
      {providers.data && <ContextWindowCard providers={providers.data} />}
    </div>
  )
}

const CONTEXT_PROVIDERS = CLOUD_PROVIDERS.map((id) => ({ id, label: PROVIDER_NAME[id] }))
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
    <Card
      title={t('settings.contextWindow')}
      description={t('settings.contextWindowHint')}
      fold="ai.context"
      summary={CONTEXT_PROVIDERS.filter(({ id }) => providers[id]).map(({ id, label }) => `${label} ${n(stored[id as keyof typeof stored] ?? providers[id].default_context_tokens)}`).join(' · ')}
    >
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
    <Card
      title={t('settings.compute')}
      description={t('settings.computeHint')}
      fold="ai.compute"
      summary={!s ? t('settings.deviceChecking') : s.backend === 'cpu' ? t('settings.compute.onCpu', { n: s.threads }) : t('settings.compute.onGpu', { name: s.gpu_name })}
    >
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
