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

    // 今天 0 点时间戳
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    // 并发查询
    const promises = [
      // 监控公众号数
      client
        .from('accounts')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active'),

      // 未读文章数（排除重复）
      client
        .from('articles')
        .select('*', { count: 'exact', head: true })
        .eq('is_read', false)
        .neq('clean_status', 'duplicate'),

      // 今日新增文章数（排除重复）
      client
        .from('articles')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', todayStart.toISOString())
        .neq('clean_status', 'duplicate'),

      // 最近采集日志
      client
        .from('crawl_logs')
        .select('id, status, started_at, finished_at, accounts_crawled, articles_found, articles_new, articles_matched, message')
        .order('started_at', { ascending: false })
        .limit(5),

      // API Key 配置
      client
        .from('settings')
        .select('key, value')
        .in('key', ['oneapi_key', 'api_key']),
    ]

    const results = await Promise.all(promises)
    const [
      { count: accountCount, error: accError },
      { count: unreadCount, error: unreadError },
      { count: todayCount, error: todayError },
      { data: logs, error: logError },
      { data: settings, error: settingsError },
    ] = results

    if (accError) throw accError
    if (unreadError) throw unreadError
    if (todayError) throw todayError
    if (logError) throw logError
    if (settingsError) throw settingsError

    // 获取余额（失败不影响其他数据）
    let balance: number | null = null
    try {
      const apiKey = settings?.find((s: any) => s.key === 'oneapi_key')?.value
        || settings?.find((s: any) => s.key === 'api_key')?.value
      if (apiKey && !apiKey.includes('****')) {
        balance = await fetchAccountBalance(apiKey)
      }
    } catch (e) {
      // 获取余额失败，忽略
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
