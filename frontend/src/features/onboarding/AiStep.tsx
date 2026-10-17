import { Check, Cpu, KeyRound, Plug, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Button, Segmented } from '@/components/ui'
import { AnimatePresence, m } from '@/components/motion'
import { cn } from '@/lib/cn'
import { fade, pop } from '@/lib/motion'
import { KeyField } from '@/features/system/KeyField'
import { CLOUD_PROVIDERS, PROVIDER_NAME, useAiKeys, type CloudProvider } from '@/features/system/KeyNotice'
import { McpClients, noClaude, useMcp } from '@/features/system/McpCard'
import { Frame } from './illustrations'

type Way = 'mcp' | 'key' | 'local'

const WAYS: Array<{ id: Way; icon: LucideIcon }> = [
  { id: 'mcp', icon: Plug },
  { id: 'key', icon: KeyRound },
  { id: 'local', icon: Cpu },
]

/**
 * Tutorial step "connect AI": three ways side by side — your Claude through MCP (subscription, no key), an API key,
 * a local model — or skip: cutting, the clean video and Whisper work without AI. Real controls, not a mockup.
 */
export function AiStep({ onNext }: { onNext: () => void }) {
  const { t, settings } = useUI()
  const mcp = useMcp()
  const keys = useAiKeys()
  const cloudKey = CLOUD_PROVIDERS.find((p) => keys[p])
  const [way, setWay] = useState<Way>(() => (cloudKey ? 'key' : keys.local ? 'local' : 'mcp'))
  const [provider, setProvider] = useState<CloudProvider>(cloudKey ?? CLOUD_PROVIDERS[0])
  const ready: Record<Way, boolean> = { mcp: mcp.connected, key: Boolean(cloudKey), local: keys.local }
  const any = Object.values(ready).some(Boolean)

  return (
    <Frame className="flex flex-col gap-5">
      <div role="radiogroup" aria-label={t('onboarding.ai.title')} className="grid grid-cols-3 gap-2">
        {WAYS.map((w) => (
          <button
            key={w.id}
            type="button"
            role="radio"
            aria-checked={way === w.id}
            onClick={() => setWay(w.id)}
            className={cn(
              'flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-colors duration-200 focus-visible:outline-none',
              way === w.id ? 'border-fg bg-raised' : 'border-line hover:border-line-strong focus-visible:border-line-strong',
            )}
          >
            <Icon as={w.icon} size={16} className={way === w.id ? 'text-fg' : 'text-muted'} />
            <span className="flex flex-col">
              <span className="text-[13px] font-medium text-fg">{t(`onboarding.ai.${w.id}`)}</span>
              <span className="text-[11.5px] text-muted">{t(`onboarding.ai.${w.id}Sub`)}</span>
            </span>
            <span className="flex h-4 items-center gap-1 text-[11px]">
              {ready[w.id] ? (
                <m.span variants={pop} initial="hidden" animate="show" className="flex items-center gap-1 text-fg">
                  <Icon as={Check} size={11} strokeWidth={2.4} />
                  {t('onboarding.ai.connected')}
                </m.span>
              ) : (
                w.id === 'mcp' && <span className="text-dim">{t('onboarding.ai.recommended')}</span>
              )}
            </span>
          </button>
        ))}
      </div>

      <div className="min-h-[148px]">
        <AnimatePresence mode="wait" initial={false}>
          <m.div key={way} variants={fade} initial="hidden" animate="show" exit="exit" className="flex flex-col gap-4">
            {way === 'mcp' && (
              <>
                <p className="text-[12.5px] leading-relaxed text-soft">{t('onboarding.ai.mcpText')}</p>
                {noClaude(mcp.status) ? <p className="text-[12.5px] leading-relaxed text-muted">{t('onboarding.ai.noClaude')}</p> : <McpClients mcp={mcp} />}
              </>
            )}
            {way === 'key' && (
              <>
                <p className="text-[12.5px] leading-relaxed text-soft">{t('onboarding.ai.keyText')}</p>
                <div className="self-start">
                  <Segmented size="sm" value={provider} onChange={setProvider} options={CLOUD_PROVIDERS.map((p) => ({ value: p, label: PROVIDER_NAME[p] }))} />
                </div>
                <KeyField key={provider} provider={provider} />
              </>
            )}
            {way === 'local' && (
              <>
                <p className="text-[12.5px] leading-relaxed text-soft">{t('onboarding.ai.localText')}</p>
                {keys.local && (
                  <p className="flex items-center gap-2 text-[12.5px] text-fg">
                    <Icon as={Check} size={13} />
                    {t('onboarding.ai.localReady', { model: settings?.ai.local_model ?? '' })}
                  </p>
                )}
              </>
            )}
          </m.div>
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
        <span className="text-[12px] leading-snug text-muted">{any ? t('onboarding.ai.ready') : t('onboarding.ai.skipHint')}</span>
        {!any && <Button size="sm" variant="ghost" onClick={onNext}>{t('onboarding.ai.skip')}</Button>}
      </div>
    </Frame>
  )
}
