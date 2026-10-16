import { RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { HotkeyCheck, HotkeyView } from '@/api/types'
import { useUI } from '@/app/AppProvider'
import { Button, Card, IconButton } from '@/components/ui'
import type { TKey } from '@/i18n'
import { cn } from '@/lib/cn'
import { comboFromEvent, comboLabel, heldLabel, matches, type HotkeyAction } from '@/lib/hotkeys'
import { isMac, shortcutLabel } from '@/lib/keys'

const SCOPES = ['global', 'lesson', 'player'] as const
const actionKey = (id: string) => `hotkey.action.${id}` as TKey

/**
 * Settings → Hotkeys. Click a combination, press the new one (up to three keys; Esc cancels): the server checks it
 * (settings/hotkeys.py: reserved, conflicts in the same place) and saves it. Reset one or all to the defaults.
 */
export function HotkeysSettings() {
  const { t, settings, patchSettings, toast } = useUI()
  const keys = settings!.hotkeys
  const [recording, setRecording] = useState<HotkeyAction | null>(null)
  const [held, setHeld] = useState('')
  const [error, setError] = useState<{ action: string; text: string } | null>(null)
  const space = t('hotkey.key.space')
  const modified = keys.filter((k) => k.combo !== k.default)

  const save = async (change: Record<string, string | null>) => {
    try {
      await patchSettings({ hotkeys: change })
      setError(null)
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const problemText = (action: string, r: HotkeyCheck) => {
    const key = comboLabel(r.combo, space) || r.combo
    if (r.problem === 'conflict') return t('hotkey.err.conflict', { key, action: t(actionKey(r.other)) })
    return t(`hotkey.err.${r.problem ?? 'format'}` as TKey, { key, action: t(actionKey(action)) })
  }

  // While recording, every key goes to the recorder (capture phase, before any hotkey of the page).
  useEffect(() => {
    if (!recording) return
    const stop = () => {
      setRecording(null)
      setHeld('')
    }
    const onKey = async (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (matches(e, 'Escape')) return stop()
      const combo = comboFromEvent(e)
      if (!combo) return setHeld(heldLabel(e))
      stop()
      try {
        const r = await api.checkHotkey(recording, combo)
        if (r.ok) await save({ [recording]: r.combo })
        else setError({ action: recording, text: problemText(recording, r) })
      } catch (err) {
        toast((err as Error).message, 'error')
      }
    }
    const onUp = (e: KeyboardEvent) => setHeld(heldLabel(e))
    const onDown = (e: MouseEvent) => (e.target as Element).closest?.('[data-hotkey-recorder]') || stop() // a click elsewhere ends it
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onUp, true)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('blur', stop)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onUp, true)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('blur', stop)
    }
  })

  const row = (k: HotkeyView) => {
    const id = k.id as HotkeyAction
    const active = recording === id
    return (
      <li key={id} className="flex flex-col gap-1.5 py-2.5">
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 text-[13px] text-soft">{t(actionKey(id))}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setError(null)
              setRecording(active ? null : id)
            }}
            data-hotkey-recorder
            aria-label={`${t(actionKey(id))}: ${t('hotkey.change')}`}
            className={cn(
              'flex h-8 min-w-24 items-center justify-center rounded-lg border px-3 font-mono text-[12.5px] transition-colors',
              active ? 'border-fg text-fg' : 'border-line-strong text-soft hover:border-fg hover:text-fg',
            )}
          >
            {active ? held || t('hotkey.record') : comboLabel(k.combo, space) || <span className="font-sans text-dim">{t('hotkey.off')}</span>}
          </button>
          <IconButton
            icon={RotateCcw}
            size="sm"
            label={`${t('hotkey.reset')}: ${comboLabel(k.default, space)}`}
            onClick={() => void save({ [id]: null })}
            className={cn(k.combo === k.default && 'invisible')}
          />
        </div>
        {active && <p className="text-[12px] text-muted">{t('hotkey.recordHint')}</p>}
        {error?.action === id && <p className="text-[12px] text-fg">{error.text}</p>}
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Card
        title={t('hotkey.title')}
        description={t('hotkey.hint')}
        actions={
          <Button size="sm" icon={RotateCcw} disabled={!modified.length} onClick={() => void save(Object.fromEntries(keys.map((k) => [k.id, null])))}>
            {t('hotkey.resetAll')}
          </Button>
        }
      >
        <div className="flex flex-col gap-5">
          {SCOPES.map((scope) => (
            <section key={scope}>
              <h4 className="label-caps">{t(`hotkey.scope.${scope}` as TKey)}</h4>
              <p className="mt-0.5 text-[12px] text-dim">{t(`hotkey.scope.${scope}.hint` as TKey, { mod: isMac ? '⌘' : 'Ctrl' })}</p>
              <ul className="mt-1 flex flex-col divide-y divide-line">{keys.filter((k) => k.scope === scope).map(row)}</ul>
            </section>
          ))}
        </div>
      </Card>
      <Card title={t('hotkey.fixed.title')} description={t('hotkey.fixed.hint')}>
        <ul className="flex flex-col divide-y divide-line">
          {([
            ['Esc', 'hotkey.fixed.esc'],
            ['Enter', 'hotkey.fixed.enter'],
            ['Shift+Enter', 'hotkey.fixed.newline'],
            [shortcutLabel('Enter'), 'hotkey.fixed.diary'],
            [shortcutLabel('V'), 'hotkey.fixed.paste'],
          ] as const).map(([key, label]) => (
            <li key={label} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1 text-[13px] text-soft">{t(label)}</span>
              <span className="flex h-8 min-w-24 items-center justify-center rounded-lg border border-line px-3 font-mono text-[12.5px] text-muted">{key}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
