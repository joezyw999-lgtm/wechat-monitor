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
export function useCachedFetch(
  key: string,
  fetcher: () => Promise<any>,
  options: { maxAge?: number; enabled?: boolean } = {}
) {
  const { maxAge = DEFAULT_MAX_AGE, enabled = true } = options
  const cache = useCache()
  const [data, setData] = useState<any>(() => {
    if (!enabled) return null
    return cache.get(key, maxAge)
  })
  const [loading, setLoading] = useState(!data && enabled)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async (forceRefresh = false) => {
    if (!enabled) return
    const cached = cache.get(key, maxAge)
    if (cached && !forceRefresh) {
      setData(cached)
      setLoading(false)
      return cached
    }

    setLoading(true)
    setError(null)
    try {
      const result = await fetcher()
      cache.set(key, result)
      setData(result)
      return result
    } catch (err: any) {
      setError(err.message || 'Fetch failed')
      throw err
    } finally {
      setLoading(false)
    }
  }, [key, fetcher, maxAge, enabled, cache])

  const refresh = useCallback(() => fetchData(true), [fetchData])

  // Auto-fetch on mount if no cached data
  useEffect(() => {
    if (enabled && !data) {
      fetchData()
    }
  }, [enabled, data, fetchData])

  return { data, loading, error, refresh }
}
