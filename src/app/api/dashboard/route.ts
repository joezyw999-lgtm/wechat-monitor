import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseClient } from '@/lib/supabase'

export async function GET() {
  try {
    const client = getSupabaseClient() as any
    
    const { data: accounts, error: accError } = await client
      .from('accounts')
      .select('id')
      .eq('status', 'active')
    if (accError) throw accError

    const { data: articles, error: artError } = await client
      .from('articles')
      .select('id, is_read, published_at, matched_keywords')
      .order('published_at', { ascending: false })
      .limit(100)
    if (artError) throw artError

    const { data: logs, error: logError } = await client
      .from('crawl_logs')
      .select('id, status, started_at')
      .order('started_at', { ascending: false })
      .limit(10)
    if (logError) throw logError

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const { count: todayCount, error: todayError } = await client
      .from('articles')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today.toISOString())
    if (todayError) throw todayError

    return NextResponse.json({
      success: true,
      data: {
        accountCount: accounts?.length || 0,
        articleCount: articles?.length || 0,
        todayArticleCount: todayCount || 0,
        unreadCount: articles?.filter((a: any) => !a.is_read).length || 0,
        recentLogs: logs || []
      }
    })
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
