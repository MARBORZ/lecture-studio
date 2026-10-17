import { GraduationCap } from 'lucide-react'
import { useState } from 'react'
import type { UILanguage } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Button, Card, Segmented, Slider, Switch } from '@/components/ui'
import { UninstallCard } from '@/features/system/Uninstall'
import { UpdateCard } from '@/features/system/Update'
import { previewTextScale, type ThemeSetting } from '@/lib/appearance'

/** Settings → Interface: language, theme, text size, the boot animation, updates and uninstall. */
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
