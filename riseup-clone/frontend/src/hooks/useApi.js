import { useCallback, useEffect, useRef, useState } from 'react'
import { onDataChanged } from '../api'

/**
 * Fetch data with loading/error state. Re-runs when `deps` change and whenever
 * another screen calls notifyDataChanged(). Keeps showing the previous data
 * while refreshing so the UI doesn't flash.
 */
export function useApi(fetcher, deps = []) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const requestId = useRef(0)
  // `fetcher` is intentionally keyed on `deps` only, like useEffect.
  const run = useCallback(fetcher, deps)

  const reload = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    try {
      const result = await run()
      if (id === requestId.current) {
        setData(result)
        setError(null)
      }
    } catch (err) {
      if (id === requestId.current) setError(err)
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [run])

  useEffect(() => {
    reload()
  }, [reload])

  useEffect(() => onDataChanged(reload), [reload])

  return { data, error, loading, reload, setData }
}

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}
