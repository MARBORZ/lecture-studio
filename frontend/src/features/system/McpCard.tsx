import { Check, Plug, Unplug } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/api/client'
import { useUI } from '@/app/AppProvider'
import { Icon } from '@/components/Icon'
import { Button, Card } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useResource } from '@/lib/useResource'

type Client = 'desktop' | 'code'

/**
 * Settings → AI: give your own Claude the lesson library. One click writes this app's MCP server into Claude Desktop
 * or Claude Code — then that Claude reads lessons and writes audits on your subscription, no API key here.
 */
export function McpCard() {
  const { t, toast } = useUI()
  const res = useResource(() => api.mcpStatus(), [])
  const [busy, setBusy] = useState<Client | null>(null)
  const s = res.data
  const run = async (client: Client, on: boolean) => {
    setBusy(client)
    try {
      res.setData(await (on ? api.mcpConnect(client) : api.mcpDisconnect(client)))
      toast(on ? t(`mcp.connected.${client}`) : t('mcp.disconnected'))
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }
  const line = (c: Client) => (!s ? '' : !s[c].available ? t('mcp.notInstalled') : s[c].connected ? t('mcp.on') : t('mcp.off'))
  return (
    <Card
      title={t('mcp.title')}
      description={t('mcp.hint')}
      fold="ai.mcp"
      summary={s ? `Claude Desktop: ${line('desktop')} · Claude Code: ${line('code')}` : undefined}
    >
      <div className="flex flex-col divide-y divide-line">
        {(['desktop', 'code'] as const).map((c) => (
          <div key={c} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
            <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg border', s?.[c].connected ? 'border-fg text-fg' : 'border-line text-muted')}>
              <Icon as={s?.[c].connected ? Check : Plug} size={15} />
            </span>
            <span className="min-w-[12rem] flex-1">
              <span className="block text-[13.5px] text-fg">{c === 'desktop' ? 'Claude Desktop' : 'Claude Code'}</span>
              <span className="block text-[12px] text-muted">{s ? line(c) : '…'}{s?.[c].connected && c === 'desktop' ? ` · ${t('mcp.restartDesktop')}` : ''}</span>
            </span>
            {s?.[c].available && (
              <Button
                size="sm"
                variant={s[c].connected ? 'ghost' : 'primary'}
                icon={s[c].connected ? Unplug : Plug}
                loading={busy === c}
                onClick={() => void run(c, !s[c].connected)}
              >
                {s[c].connected ? t('mcp.disconnect') : t('mcp.connect')}
              </Button>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}
