import { Cloud, Cpu, KeyRound, SquareTerminal } from 'lucide-react'
import { Link } from 'react-router'
import type { AIProvider } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/cn'

/** The cloud AI providers, in the order every choice shows them; the local model comes after them. */
export const CLOUD_PROVIDERS = ['deepseek', 'gemini', 'openai', 'anthropic'] as const
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number]

export const PROVIDER_NAME: Record<AIProvider, string> = { deepseek: 'DeepSeek', gemini: 'Gemini', openai: 'ChatGPT', anthropic: 'Claude', claude_code: 'Claude Code', local: 'Ollama / LM Studio' }
/** The company behind a key (Settings → AI, the tutorial). */
export const KEY_TITLE: Record<CloudProvider, string> = { deepseek: 'DeepSeek', gemini: 'Google Gemini', openai: 'OpenAI · ChatGPT', anthropic: 'Anthropic · Claude' }

/** Which AI providers are ready: a key for the cloud ones (settings.json or .env fallback), a signed-in `claude` for
 *  Claude Code, a chosen model for the local one. */
export function useAiKeys(): Record<AIProvider, boolean> & { any: boolean; loaded: boolean } {
  const { settings } = useUI()
  const cloud = Object.fromEntries(CLOUD_PROVIDERS.map((p) => [p, Boolean(settings) && settings!.ai[`${p}_key`].source !== 'none'])) as Record<CloudProvider, boolean>
  const local = Boolean(settings?.ai.local_model)
  const claude_code = Boolean(settings?.ai.claude_code.signed_in)
  return { ...cloud, claude_code, local, any: Object.values(cloud).some(Boolean) || claude_code || local, loaded: Boolean(settings) }
}

/**
 * The provider choice, one list for every control (Segmented, Select): the cloud ones, Claude Code (the user's own
 * `claude` on their plan), then the local model.
 * Each says what it is and whether it is ready (a key, a chosen model).
 */
export function useProviderOptions(): { value: AIProvider; label: string; hint: string; icon: typeof Cloud }[] {
  const { t, settings } = useUI()
  const keys = useAiKeys()
  const ready = (p: AIProvider, what: string) => (keys[p] ? what : t('ai.notReady'))
  return [
    ...CLOUD_PROVIDERS.map((p) => ({ value: p as AIProvider, label: PROVIDER_NAME[p], hint: ready(p, t(`ai.hint.${p}`)), icon: Cloud })),
    {
      value: 'claude_code',
      label: `${PROVIDER_NAME.claude_code} · ${t('ai.plan')}`,
      hint: keys.claude_code ? t('ai.hint.claude_code') : settings?.ai.claude_code.installed ? t('ai.claudeCode.signIn') : t('ai.claudeCode.missing'),
      icon: SquareTerminal,
    },
    { value: 'local', label: t('ai.local.short'), hint: ready('local', settings?.ai.local_model || t('ai.hint.local')), icon: Cpu },
  ]
}

/** The provider to start with: the preferred one if it has a key, otherwise one that has. */
export function pickProvider(preferred: AIProvider, keys: Record<AIProvider, boolean>): AIProvider {
  if (keys[preferred]) return preferred
  return (Object.keys(PROVIDER_NAME) as AIProvider[]).find((p) => keys[p]) ?? preferred
}

/**
 * The one "API key missing" notice. Renders nothing when the key is there.
 * When another provider has a key, it offers to switch to it (onSwitch) instead of only pointing at Settings.
 */
export function KeyNotice({ provider, onSwitch, className }: { provider?: AIProvider; onSwitch?: (p: AIProvider) => void; className?: string }) {
  const { t } = useUI()
  const keys = useAiKeys()
  if (!keys.loaded || (provider ? keys[provider] : keys.any)) return null
  const name = provider ? PROVIDER_NAME[provider] : ''
  const local = provider === 'local'
  const claudeCode = provider === 'claude_code'
  const other = provider && onSwitch ? (Object.keys(PROVIDER_NAME) as AIProvider[]).find((p) => p !== provider && keys[p]) : undefined
  return (
    <div className={cn('flex flex-wrap items-center gap-3 rounded-xl border border-fg px-4 py-3', className)}>
      <Icon as={KeyRound} size={16} />
      <div className="min-w-[12rem] flex-1">
        <p className="text-[13.5px] font-medium text-fg">
          {local ? t('keys.localMissing') : claudeCode ? t('keys.claudeCodeMissing') : <>{t('keys.missingTitle')}{name && `: ${name}`}</>}
        </p>
        <p className="text-[12.5px] text-muted">
          {other ? t('keys.otherHasKey', { name: PROVIDER_NAME[other] }) : t(local ? 'keys.localMissingText' : claudeCode ? 'keys.claudeCodeMissingText' : 'keys.missingText')}
        </p>
      </div>
      {other && (
        <button type="button" onClick={() => onSwitch!(other)} className="rounded-lg border border-fg px-3 py-1.5 text-[12.5px] font-medium text-fg hover:bg-fg hover:text-bg">
          {t('keys.switchTo', { name: PROVIDER_NAME[other] })}
        </button>
      )}
      <Link to="/settings/ai" className="rounded-lg bg-fg px-3 py-1.5 text-[12.5px] font-medium text-bg hover:bg-soft">
        {t('keys.open')}
      </Link>
    </div>
  )
}
