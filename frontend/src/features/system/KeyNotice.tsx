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

/** The one "API key missing" notice. Renders nothing when the key is there. */
export function KeyNotice({ provider, className }: { provider?: AIProvider; className?: string }) {
  const { t } = useUI()
  const keys = useAiKeys()
  if (!keys.loaded || (provider ? keys[provider] : keys.any)) return null
  const name = provider === 'gemini' ? 'Gemini' : provider === 'deepseek' ? 'DeepSeek' : ''
  return (
    <div className={cn('flex flex-wrap items-center gap-3 rounded-xl border border-fg px-4 py-3', className)}>
      <Icon as={KeyRound} size={16} />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-fg">{t('keys.missingTitle')}{name && `: ${name}`}</p>
        <p className="text-[12.5px] text-muted">{t('keys.missingText')}</p>
      </div>
      <Link to="/settings/ai" className="rounded-lg bg-fg px-3 py-1.5 text-[12.5px] font-medium text-bg hover:bg-soft">
        {t('keys.open')}
      </Link>
    </div>
  )
}
