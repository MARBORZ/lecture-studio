import { Power } from 'lucide-react'
import { useEffect } from 'react'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'

export function StoppedScreen() {
  const { t } = useUI()
  useEffect(() => {
    // The launcher closes the app window; this is the fallback for a regular browser tab.
    const id = setTimeout(() => window.close(), 1500)
    return () => clearTimeout(id)
  }, [])
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-bg text-center">
      <span className="flex size-14 items-center justify-center rounded-full border border-line-strong">
        <Icon as={Power} size={22} />
      </span>
      <h1 className="text-[18px] font-semibold">{t('system.stopped')}</h1>
      <p className="max-w-sm text-[13.5px] text-muted">{t('system.stoppedHint')}</p>
    </div>
  )
}
