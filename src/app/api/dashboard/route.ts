import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { fetchAccountBalance } from '@/lib/api-client'

// 服务端短缓存，避免重复全量统计
let cacheData: any = null
let cacheTime = 0
const CACHE_TTL = 30 * 1000 // 30 秒

export async function GET(request: NextRequest) {
  const session = await requireAuth(request)
  if (session instanceof Response) return session

  try {
    const now = Date.now()
    if (cacheData && now - cacheTime < CACHE_TTL) {
      return NextResponse.json({ success: true, data: cacheData })
    }

    const client = getSupabaseServiceClient() as any

    // Run database queries in parallel
    const [
      { count: accountCount, error: accError },
      { count: unreadCount, error: unreadError },
      { count: todayCount, error: todayError },
      { data: logs, error: logError },
      { data: settings, error: settingsError },
    ] = await Promise.all([
      // Active accounts count
      client
        .from('accounts')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active'),

      // Unread articles count
      client
        .from('articles')
        .select('*', { count: 'exact', head: true })
        .eq('is_read', false),

      // Recent crawl logs (last 5)
      client
        .from('crawl_logs')
        .select('id, status, started_at, finished_at, accounts_crawled, articles_found, articles_new, articles_matched, message')
        .order('started_at', { ascending: false })
        .limit(5),

      // Get API key settings
      client
        .from('settings')
        .select('key, value')
        .in('key', ['oneapi_key', 'api_key']),
    ])

    if (accError) throw accError
    if (unreadError) throw unreadError
    if (todayError) throw todayError
    if (logError) throw logError
    if (settingsError) throw settingsError

    // Fetch balance (fail silently, don't block other data)
    let balance: number | null = null
    try {
      const apiKey = settings?.find((s: any) => s.key === 'oneapi_key')?.value
        || settings?.find((s: any) => s.key === 'api_key')?.value
      if (apiKey && !apiKey.includes('****')) {
        balance = await fetchAccountBalance(apiKey)
      }
    } catch (e) {
      // Balance fetch failed, ignore
    }

    const result = {
      accountCount: accountCount || 0,
      todayArticleCount: todayCount || 0,
      unreadCount: unreadCount || 0,
      balance,
      recentLogs: logs || []
    }

    cacheData = result
    cacheTime = Date.now()

    return NextResponse.json({ success: true, data: result })
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
