import { KeyRound, PlugZap } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/api/client'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Button, Input } from '@/components/ui'
import { KEY_TITLE, type CloudProvider } from './KeyNotice'

/** API key input with source/hint, Save, Test, Reset. Used in Settings -> AI and in the first-run tutorial. */
export function KeyField({ provider }: { provider: CloudProvider }) {
  const { t, settings, patchSettings, toast } = useUI()
  const status = settings!.ai[`${provider}_key`]
  const [value, setValue] = useState('')
  const [testing, setTesting] = useState(false)
  const test = async () => {
    setTesting(true)
    try {
      const r = await api.testKey(provider)
      toast(r.ok ? `${t('settings.keyOk')}: ${r.model}` : `${t('settings.keyFail')}: ${r.error}`, r.ok ? 'info' : 'error')
    } finally {
      setTesting(false)
    }
  }
  const save = async (key: string) => {
    await patchSettings({ ai: { [`${provider}_api_key`]: key } }).then(
      () => {
        setValue('')
        toast(t('common.saved'))
      },
      (e) => toast(e.message, 'error'),
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13.5px] font-medium">{KEY_TITLE[provider]}</span>
        <span className="flex items-center gap-1.5 text-[12px] text-muted">
          <Icon as={KeyRound} size={13} />
          {t(`settings.keySource.${status.source}`)}
          {status.hint && <code className="font-mono text-soft">{status.hint}</code>}
        </span>
      </div>
      {/* in a narrow place (the tutorial) the buttons wrap under the field instead of squeezing it */}
      <form className="flex flex-wrap gap-2" onSubmit={(e) => (e.preventDefault(), void save(value.trim()))}>
        <Input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder={t('settings.keyPlaceholder')} className="min-w-48 flex-1 font-mono text-[12.5px]" />
        <Button type="submit" variant="primary" disabled={!value.trim()}>{t('common.save')}</Button>
        {status.source !== 'none' && <Button icon={PlugZap} loading={testing} onClick={test}>{t('settings.keyTest')}</Button>}
        {status.source === 'settings' && <Button variant="ghost" onClick={() => save('')}>{t('settings.keyClear')}</Button>}
      </form>
    </div>
  )
}
