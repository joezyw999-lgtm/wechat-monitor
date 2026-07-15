'use client'

import { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from 'react'

interface CacheEntry {
  data: any
  timestamp: number
}

interface CacheContextType {
  get: (key: string, maxAge?: number) => any
  set: (key: string, data: any) => void
  invalidate: (key: string) => void
  invalidateAll: () => void
}

const CacheContext = createContext<CacheContextType | null>(null)

const DEFAULT_MAX_AGE = 30000 // 30 seconds

export function CacheProvider({ children }: { children: ReactNode }) {
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map())

  const get = useCallback((key: string, maxAge: number = DEFAULT_MAX_AGE): any => {
    const entry = cacheRef.current.get(key)
    if (!entry) return null
    if (Date.now() - entry.timestamp > maxAge) {
      cacheRef.current.delete(key)
      return null
    }
    return entry.data
  }, [])

  const set = useCallback((key: string, data: any) => {
    cacheRef.current.set(key, { data, timestamp: Date.now() })
  }, [])

  const invalidate = useCallback((key: string) => {
    cacheRef.current.delete(key)
  }, [])

  const invalidateAll = useCallback(() => {
    cacheRef.current.clear()
  }, [])

  return (
    <CacheContext.Provider value={{ get, set, invalidate, invalidateAll }}>
      {children}
    </CacheContext.Provider>
  )
}

export function useCache() {
  const context = useContext(CacheContext)
  if (!context) throw new Error('useCache must be used within CacheProvider')
  return context
}

// Hook for data fetching with caching
// 支持 SWR (stale-while-revalidate)：有缓存时先展示缓存，后台再静默刷新
export function useCachedFetch(
  key: string,
  fetcher: () => Promise<any>,
  options: { maxAge?: number; enabled?: boolean; swr?: boolean } = {}
) {
  const { maxAge = DEFAULT_MAX_AGE, enabled = true, swr = true } = options
  const cache = useCache()
  const [data, setData] = useState<any>(() => {
    if (!enabled) return null
    return cache.get(key, maxAge)
  })
  const [loading, setLoading] = useState(!data && enabled)
  const [error, setError] = useState<string | null>(null)

  // Use ref to store fetcher to avoid dependency issues
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  }, [fetcher])

  const fetchData = useCallback(async (forceRefresh = false) => {
    if (!enabled) return
    const cached = cache.get(key, maxAge)

    // SWR 模式：有缓存先展示，然后后台刷新
    if (cached && !forceRefresh) {
      setData(cached)
      setLoading(false)
      if (swr) {
        // 后台静默刷新，不改变 loading 状态
        fetcherRef.current()
          .then((result: any) => {
            cache.set(key, result)
            setData(result)
          })
          .catch(() => {
            // 静默刷新失败不影响已有缓存
          })
      }
      return cached
    }

    setLoading(true)
    setError(null)
    try {
      const result = await fetcherRef.current()
      cache.set(key, result)
      setData(result)
      return result
    } catch (err: any) {
      setError(err.message || 'Fetch failed')
      throw err
    } finally {
      setLoading(false)
    }
  }, [key, maxAge, enabled, cache, swr])

  const refresh = useCallback(() => fetchData(true), [fetchData])

  // Auto-fetch on mount: 有缓存也触发一次（SWR 模式下走后台刷新）
  useEffect(() => {
    if (!enabled) return
    if (!data) {
      fetchData()
    } else if (swr) {
      // 已挂载时有缓存，也做一次后台刷新
      fetcherRef.current()
        .then((result: any) => {
          cache.set(key, result)
          setData(result)
        })
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key])

  return { data, loading, error, refresh, fetchData }
}
