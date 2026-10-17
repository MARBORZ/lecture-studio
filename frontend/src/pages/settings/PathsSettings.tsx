import { Check, FolderInput } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { PathCheckResult } from '@/api/types'
import { useLibrary, useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Button, Card, Field, Input, Modal } from '@/components/ui'
import { cn } from '@/lib/cn'

/** Settings → Paths: where the library lives, and moving or attaching another data folder. */
function PathRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-2">
      <span className="text-[12px] text-muted">{label}</span>
      <code className="font-mono text-[12.5px] break-all text-soft">{value}</code>
    </div>
  )
}


export function PathsSettings() {
  const { t, settings, patchSettings, toast, openModal } = useUI()
  const p = settings!.paths
  const [saved, setSaved] = useState(p.export_dir)
  const [exportDir, setExportDir] = useState(p.export_dir)
  if (saved !== p.export_dir) {
    setSaved(p.export_dir)
    setExportDir(p.export_dir)
  }

  return (
    <div className="flex flex-col gap-6">
      <Card
        title={t('settings.dataDir')}
        description={t('settings.dataDirHint')}
        actions={<Button size="sm" icon={FolderInput} onClick={() => openModal((close) => <DataDirModal close={close} />)}>{t('settings.changeDataDir')}</Button>}
      >
        <code className="block font-mono text-[13px] break-all text-fg">{p.data_dir}</code>
      </Card>

      <Card title={t('settings.exportDir')} description={t('settings.exportDirHint')}>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            await patchSettings({ export_dir: exportDir }).then(() => toast(t('common.saved')), (err) => toast(err.message, 'error'))
          }}
        >
          <Input value={exportDir} onChange={(e) => setExportDir(e.target.value)} placeholder="/Users/…/Obsidian/Course" className="font-mono text-[12.5px]" />
          <Button type="submit" variant="primary" disabled={exportDir === p.export_dir}>{t('common.save')}</Button>
        </form>
      </Card>

      <Card title={t('settings.system')}>
        <div className="divide-y divide-line">
          <PathRow label="notebook_db.json" value={p.db_file} />
          <PathRow label="output/" value={p.output_dir} />
          <PathRow label="temp/" value={p.temp_dir} />
          <PathRow label={t('settings.appHome')} value={p.app_home} />
          <PathRow label="logs/" value={p.logs_dir} />
        </div>
      </Card>
    </div>
  )
}

function DataDirModal({ close }: { close: () => void }) {
  const { t, replaceSettings, toast } = useUI()
  const { refresh } = useLibrary()
  const [path, setPath] = useState('')
  const [check, setCheck] = useState<PathCheckResult | null>(null)
  const [mode, setMode] = useState<'attach' | 'move'>('attach')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!path.trim()) return
    const id = setTimeout(() => void api.checkPath(path).then(setCheck).catch(() => setCheck(null)), 350)
    return () => clearTimeout(id)
  }, [path])

  const valid = Boolean(check && !check.error && !(mode === 'move' && check.has_library))

  return (
    <Modal
      title={t('settings.changeDataDir')}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!valid}
            onClick={async () => {
              setBusy(true)
              try {
                replaceSettings(await api.changeDataDir(path, mode))
                await refresh()
                toast(t('common.saved'))
                close()
              } catch (e) {
                toast((e as Error).message, 'error')
              } finally {
                setBusy(false)
              }
            }}
          >
            {mode === 'move' ? t('settings.move') : t('settings.attach')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label={t('settings.newPath')}
          error={check?.error}
          hint={
            check && !check.error
              ? check.has_library
                ? `${t('settings.pathHasLibrary')}: ${check.lesson_count}`
                : check.exists
                  ? t('settings.pathOk')
                  : t('settings.pathNew')
              : undefined
          }
        >
          <Input
            value={path}
            onChange={(e) => {
              setPath(e.target.value)
              setCheck(null)
            }}
            placeholder="/Users/…/LectureStudioData" className="font-mono text-[12.5px]" />
        </Field>
        <div className="grid gap-2 sm:grid-cols-2">
          {(['attach', 'move'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn('flex flex-col gap-1 rounded-xl border p-3 text-left', mode === m ? 'border-fg' : 'border-line hover:border-line-strong')}
            >
              <span className="flex items-center gap-2 text-[13.5px] font-medium">
                {mode === m && <Icon as={Check} size={14} />}
                {t(m === 'move' ? 'settings.move' : 'settings.attach')}
              </span>
              <span className="text-[12px] leading-snug text-muted">{t(m === 'move' ? 'settings.moveHint' : 'settings.attachHint')}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}
