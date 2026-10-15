import { useCallback, useEffect, useRef, useState } from 'react'

export interface Resource<T> {
  data: T | undefined
  error: Error | undefined
  loading: boolean
  reload: () => Promise<void>
  setData: (updater: T | ((prev: T | undefined) => T)) => void
}

interface State<T> { key: string; data?: T; error?: Error; loading: boolean }

/**
 * Fetch whenever deps change, with reload/setData. Responses from stale deps are dropped.
 * keep: show the previous data while the new deps load (a view parameter changed, not the subject).
 */
export function useResource<T>(fetcher: () => Promise<T>, deps: unknown[], { keep = false }: { keep?: boolean } = {}): Resource<T> {
  const key = JSON.stringify(deps)
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  const [state, setState] = useState<State<T>>({ key, loading: true })
  if (state.key !== key) setState((s) => ({ key, loading: true, data: keep ? s.data : undefined })) // deps changed: reset during render

  const seq = useRef(0)
  const run = useCallback(async (k: string) => {
    const id = ++seq.current
    try {
      const data = await fetcherRef.current()
      if (id === seq.current) setState({ key: k, data, loading: false })
    } catch (e) {
      if (id === seq.current) setState((s) => ({ ...s, key: k, error: e as Error, loading: false }))
    }
  }, [])

  useEffect(() => {
    void run(key)
  }, [key, run])

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    await run(key)
  }, [key, run])

  const setData = useCallback((updater: T | ((prev: T | undefined) => T)) => {
    setState((s) => ({ ...s, data: typeof updater === 'function' ? (updater as (p: T | undefined) => T)(s.data) : updater }))
  }, [])

  return { data: state.data, error: state.error, loading: state.loading, reload, setData }
}
