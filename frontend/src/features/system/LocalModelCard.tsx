import { Check, Cpu, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/api/client'
import type { LocalServer } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Button, Card, Field, Input, Segmented, Select, Switch } from '@/components/ui'
import { formatCount } from '@/lib/format'
import { useResource } from '@/lib/useResource'

const PRESETS = { ollama: 'http://127.0.0.1:11434/v1', lmstudio: 'http://127.0.0.1:1234/v1' } as const
const WINDOWS = [8_000, 16_000, 32_000, 64_000, 128_000]
const DEFAULT_WINDOW = 8_000

/**
 * Settings → AI → Local model: Ollama or LM Studio on this computer, no key and nothing sent anywhere.
 * Check asks the server for its models (and how much context each supports); the window is what every request is
 * sized for (Ollama gets it as num_ctx), 8k by default: a larger one needs more memory.
 */
export function LocalModelCard() {
  const { t, lang, settings, patchSettings, toast } = useUI()
  const ai = settings!.ai
  const [url, setUrl] = useState(ai.local_base_url)
  // the saved address is asked once when the card opens, so the models are listed without a click; Check asks again
  const first = useResource(() => api.checkLocal(ai.local_base_url), [])
  const [checked, setChecked] = useState<LocalServer | null>(null)
  const server = checked ?? first.data ?? null
  const [checking, setChecking] = useState(false)
  const saved = ai.context_tokens.local
  const window = saved ?? DEFAULT_WINDOW
  const model = server?.models.find((m) => m.id === ai.local_model)
  const limit = model?.context_tokens ?? null
  const n = (v: number) => formatCount(v, lang)

  const patch = (p: Parameters<typeof patchSettings>[0]) => patchSettings(p).catch((e: Error) => toast(e.message, 'error'))

  const check = async (address = url) => {
    setChecking(true)
    try {
      const info = await api.checkLocal(address)
      setChecked(info)
      if (info.ok) {
        const keep = info.models.some((m) => m.id === ai.local_model)
        await patch({ ai: { local_base_url: info.base_url, ...(keep || !info.models.length ? {} : { local_model: info.models[0].id }) } })
      }
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setChecking(false)
    }
  }

  const options = server?.ok && server.models.length
    ? server.models.map((m) => ({ value: m.id, label: m.context_tokens ? `${m.id} · ${t('settings.local.upTo', { n: n(m.context_tokens) })}` : m.id }))
    : ai.local_model ? [{ value: ai.local_model, label: ai.local_model }] : [{ value: '', label: t('settings.local.noModels') }]

  return (
    <Card title={t('settings.local')} description={t('settings.local.hint')} fold="ai.local" summary={ai.local_model ? `${ai.local_model} · ${ai.local_base_url.replace(/^https?:\/\//, '')}` : t('ai.notReady')}>
      <div className="flex flex-col gap-4">
        <Field label={t('settings.local.address')} hint={t('settings.local.addressHint')}>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void check()} className="min-w-60 flex-1 font-mono" spellCheck={false} />
            <Button icon={Cpu} loading={checking || first.loading} onClick={() => void check()}>{t('settings.local.check')}</Button>
          </div>
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {(Object.entries(PRESETS) as [keyof typeof PRESETS, string][]).map(([name, address]) => (
            <Button key={name} size="sm" variant={url === address ? 'primary' : 'secondary'} onClick={() => (setUrl(address), void check(address))}>
              {name === 'ollama' ? 'Ollama' : 'LM Studio'}
            </Button>
          ))}
        </div>
        {server && (
          <p className={server.ok ? 'flex items-center gap-1.5 text-[12.5px] text-soft' : 'rounded-lg border border-fg px-3 py-2 text-[12.5px] text-fg'}>
            {server.ok && <Icon as={Check} size={13} />}
            {server.ok
              ? t('settings.local.found', { kind: server.kind === 'ollama' ? 'Ollama' : 'LM Studio', n: server.models.length })
              : server.error}
          </p>
        )}
        <Field label={t('settings.local.model')} hint={server?.ok && !server.models.length ? t('settings.local.pullHint') : undefined}>
          <Select value={ai.local_model} onChange={(v) => void patch({ ai: { local_model: v } })} options={options} />
        </Field>
        <Field
          label={t('settings.local.window')}
          hint={limit ? t('settings.local.windowLimit', { n: n(limit) }) : t('settings.local.windowHint')}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              size="sm"
              value={String(window)}
              onChange={(v) => void patch({ ai: { context_tokens: { local: Number(v) === DEFAULT_WINDOW ? null : Number(v) } } })}
              options={WINDOWS.filter((w) => !limit || w <= limit || w === DEFAULT_WINDOW).map((w) => ({ value: String(w), label: `${n(w / 1000)}k` }))}
            />
            {saved !== undefined && !WINDOWS.includes(saved) && <span className="font-mono text-[12px] text-muted">{n(saved)}</span>}
            {saved !== undefined && (
              <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => void patch({ ai: { context_tokens: { local: null } } })}>
                {t('settings.contextWindow.reset')}
              </Button>
            )}
          </div>
        </Field>
        <Switch
          checked={ai.local_thinking}
          onChange={(v) => void patch({ ai: { local_thinking: v } })}
          label={t('settings.local.thinking')}
          hint={t('settings.local.thinkingHint')}
        />
      </div>
    </Card>
  )
}
