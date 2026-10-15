import { useUI, type ConfirmOptions } from '@/app/AppProvider'
import { Button } from './Button'
import { Modal } from './Modal'

export function ConfirmDialog({ opts, onResult }: { opts: ConfirmOptions; onResult: (ok: boolean) => void }) {
  const { t } = useUI()
  return (
    <Modal
      title={opts.title}
      width="sm"
      onClose={() => onResult(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => onResult(false)}>{t('common.cancel')}</Button>
          <Button variant={opts.danger ? 'danger' : 'primary'} data-autofocus onClick={() => onResult(true)}>
            {opts.confirmLabel ?? t('common.confirm')}
          </Button>
        </>
      }
    >
      {opts.text && <div className="text-[13.5px] leading-relaxed text-soft">{opts.text}</div>}
    </Modal>
  )
}
