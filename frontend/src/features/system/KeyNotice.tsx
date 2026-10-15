import { KeyRound } from 'lucide-react'
import { Link } from 'react-router'
import type { AIProvider } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { cn } from '@/lib/cn'

/** Which AI providers have a key (settings.json or .env fallback). */
export function useAiKeys(): Record<AIProvider, boolean> & { any: boolean; loaded: boolean } {
  const { settings } = useUI()
  const deepseek = settings?.ai.deepseek_key.source !== 'none'
  const gemini = settings?.ai.gemini_key.source !== 'none'
  return { deepseek, gemini, any: deepseek || gemini, loaded: Boolean(settings) }
}

export const PROVIDER_NAME: Record<AIProvider, string> = { deepseek: 'DeepSeek', gemini: 'Gemini' }

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
  const other = provider && onSwitch ? (Object.keys(PROVIDER_NAME) as AIProvider[]).find((p) => p !== provider && keys[p]) : undefined
  return (
    <div className={cn('flex flex-wrap items-center gap-3 rounded-xl border border-fg px-4 py-3', className)}>
      <Icon as={KeyRound} size={16} />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-fg">{t('keys.missingTitle')}{name && `: ${name}`}</p>
        <p className="text-[12.5px] text-muted">{other ? t('keys.otherHasKey', { name: PROVIDER_NAME[other] }) : t('keys.missingText')}</p>
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
