import { CircleSlash } from 'lucide-react'
import { Link, useRouteError } from 'react-router'
import { useUI } from '@/app/AppProvider'
import { Button, EmptyState } from '@/components/ui'

export function NotFound() {
  const { t } = useUI()
  return <EmptyState icon={CircleSlash} title={t('error.notFound')} action={<Link to="/library"><Button>{t('error.home')}</Button></Link>} />
}

/** Rendered outside AppProvider by the router: no hooks from the app here. */
export function RouteError() {
  const error = useRouteError() as Error | undefined
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-[16px] font-semibold">Ошибка интерфейса</h1>
      <pre className="max-w-xl overflow-auto rounded-lg border border-line p-3 text-left font-mono text-[12px] text-muted">{error?.message ?? String(error)}</pre>
      <a href="/library" className="text-[13px] underline">В библиотеку</a>
    </div>
  )
}
