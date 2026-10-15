import { Check, FolderInput, GraduationCap, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { PathCheckResult, PipelineDefaults, PromptView, UILanguage } from '@/api/types'
import { useLibrary, useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Button, Card, Field, Input, Modal, Segmented, Select, Textarea } from '@/components/ui'
import { SkeletonCard } from '@/components/skeleton'
import { FALLBACK_DEFAULTS, PipelineOptionsFields } from '@/features/jobs/PipelineOptionsFields'
import { KeyField } from '@/features/system/KeyField'
import { cn } from '@/lib/cn'
import type { TKey } from '@/i18n'
import { useResource } from '@/lib/useResource'

function PathRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-2">
      <span className="text-[12px] text-muted">{label}</span>
      <code className="font-mono text-[12.5px] break-all text-soft">{value}</code>
    </div>
  )
}

// ---------------------------------------------------------------- paths

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

// ---------------------------------------------------------------- AI

export function AISettingsSection() {
  const { t, settings, patchSettings, toast } = useUI()
  const providers = useResource(() => api.providers(), [])
  const ai = settings!.ai
  const models = (cat: string) => (providers.data?.[cat]?.supported_models ?? []).map((m) => ({ value: m, label: m }))
  const patch = (p: Record<string, string>) => patchSettings({ ai: p }).catch((e) => toast(e.message, 'error'))

  return (
    <div className="flex flex-col gap-6">
      <Card title={t('settings.keys')} description={t('settings.keysHint')}>
        <div className="flex flex-col gap-6">
          <KeyField provider="deepseek" />
          <KeyField provider="gemini" />
        </div>
      </Card>
      <Card title={t('settings.models')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="DeepSeek">
            <Select value={ai.deepseek_model} onChange={(v) => patch({ deepseek_model: v })} options={models('deepseek').length ? models('deepseek') : [{ value: ai.deepseek_model, label: ai.deepseek_model }]} />
          </Field>
          <Field label="Gemini">
            <Select value={ai.gemini_model} onChange={(v) => patch({ gemini_model: v })} options={models('gemini').length ? models('gemini') : [{ value: ai.gemini_model, label: ai.gemini_model }]} />
          </Field>
          <Field label={t('settings.whisperModel')}>
            <Select value={ai.whisper_model} onChange={(v) => patch({ whisper_model: v })} options={['large-v3-turbo', 'large-v3', 'medium', 'small'].map((m) => ({ value: m, label: m }))} />
          </Field>
          <Field label={t('settings.assistantProvider')}>
            <Segmented value={ai.assistant_provider} onChange={(v) => patch({ assistant_provider: v })} options={[{ value: 'deepseek', label: 'DeepSeek' }, { value: 'gemini', label: 'Gemini' }]} />
          </Field>
        </div>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------- processing

export function ProcessingSettings() {
  const { t, settings, patchSettings, toast } = useUI()
  const [opts, setOpts] = useState<Required<PipelineDefaults>>({ ...FALLBACK_DEFAULTS, ...settings!.pipeline } as Required<PipelineDefaults>)
  const dirty = JSON.stringify(opts) !== JSON.stringify({ ...FALLBACK_DEFAULTS, ...settings!.pipeline })
  return (
    <Card
      title={t('settings.pipelineDefaults')}
      actions={
        <Button size="sm" variant="primary" disabled={!dirty} onClick={() => patchSettings({ pipeline: opts }).then(() => toast(t('common.saved')), (e) => toast(e.message, 'error'))}>
          {t('common.save')}
        </Button>
      }
    >
      <PipelineOptionsFields value={opts} onChange={setOpts} />
    </Card>
  )
}

// ---------------------------------------------------------------- interface

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
      <Card title={t('onboarding.replay')} description={t('onboarding.replayHint')}>
        <Button icon={GraduationCap} onClick={() => setTutorialOpen(true)}>{t('onboarding.replay')}</Button>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------- AI instructions

function PromptEditor({ block, onChange }: { block: PromptView; onChange: (all: PromptView[]) => void }) {
  const { t, toast, confirm } = useUI()
  /** Block titles are keyed in i18n; a block added on the backend later still shows its own title. */
  const tr = (key: string, fallback: string) => {
    const v = t(key as TKey)
    return v === key ? fallback : v
  }
  const [value, setValue] = useState(block.value)
  const [saved, setSaved] = useState(block.value)
  if (saved !== block.value) {
    setSaved(block.value) // server state changed (save/reset): follow it
    setValue(block.value)
  }
  const dirty = value.trim() !== block.value.trim()
  const run = (p: Promise<PromptView[]>) => p.then(onChange).catch((e) => toast(e.message, 'error'))

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-5 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="text-[13.5px] font-medium text-fg">{tr(`prompt.${block.key}.title`, block.title)}</span>
          <span className="ml-2 text-[12px] text-muted">{tr(`prompt.${block.key}.hint`, block.hint)}</span>
        </div>
        <span className={cn('rounded-md border px-1.5 py-0.5 text-[11px]', block.modified ? 'border-fg text-fg' : 'border-line text-dim')}>
          {block.modified ? t('prompts.modified') : t('prompts.default')}
        </span>
      </div>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={Math.min(18, Math.max(3, value.split('\n').length + 1))}
        className="font-mono text-[12.5px] leading-relaxed"
      />
      <div className="flex justify-end gap-2">
        {block.modified && (
          <Button
            size="sm"
            variant="ghost"
            icon={RotateCcw}
            onClick={async () => {
              if (await confirm({ title: `${t('prompts.reset')}: ${tr(`prompt.${block.key}.title`, block.title)}`, text: t('prompts.resetText') })) void run(api.resetPrompt(block.key))
            }}
          >
            {t('prompts.reset')}
          </Button>
        )}
        <Button size="sm" variant="primary" disabled={!dirty || !value.trim()} onClick={() => run(api.savePrompt(block.key, value)).then(() => toast(t('common.saved')))}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  )
}

export function PromptsSettings() {
  const { t } = useUI()
  const blocks = useResource(() => api.prompts(), [])
  if (!blocks.data) return <SkeletonCard />
  return (
    <div className="flex flex-col gap-6">
      <p className="text-[13px] leading-relaxed text-muted">{t('prompts.hint')}</p>
      {(['audit', 'assistant'] as const).map((group) => (
        <Card key={group} title={t(`prompts.group.${group}`)} description={group === 'audit' ? t('prompts.applyHint') : undefined}>
          <div className="flex flex-col gap-5">
            {blocks.data!.filter((b) => b.group === group).map((b) => (
              <PromptEditor key={b.key} block={b} onChange={(all) => blocks.setData(all)} />
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}
