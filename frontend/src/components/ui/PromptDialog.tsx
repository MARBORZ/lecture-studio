import { useState } from 'react'
import { useUI, type PromptOptions } from '@/app/AppProvider'
import { Button } from './Button'
import { Field, Input } from './Field'
import { Modal } from './Modal'

/** Single-value text dialog behind promptText(). */
export function PromptDialog({ opts, onResult }: { opts: PromptOptions; onResult: (value: string | null) => void }) {
  const { t } = useUI()
  const [value, setValue] = useState(opts.initial ?? '')
  const submit = () => value.trim() && onResult(value.trim())
  return (
    <Modal
      title={opts.title}
      width="sm"
      onClose={() => onResult(null)}
      footer={
        <>
          <Button variant="ghost" onClick={() => onResult(null)}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!value.trim()} onClick={submit}>{opts.confirmLabel ?? t('common.save')}</Button>
        </>
      }
    >
      <form onSubmit={(e) => (e.preventDefault(), submit())}>
        <Field label={opts.label}>
          <Input value={value} onChange={(e) => setValue(e.target.value)} maxLength={opts.maxLength ?? 120} />
        </Field>
      </form>
    </Modal>
  )
}
