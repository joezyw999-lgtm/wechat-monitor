import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function GET() {
  try {
    const client = getSupabaseServiceClient() as any
    
    // Run all queries in parallel using Promise.all
    const [
      { count: accountCount, error: accError },
      { count: articleCount, error: artError },
      { count: unreadCount, error: unreadError },
      { data: logs, error: logError },
    ] = await Promise.all([
      // Active accounts count
      client
        .from('accounts')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active'),
      
      // Total articles count
      client
        .from('articles')
        .select('*', { count: 'exact', head: true }),
      
      // Unread articles count
      client
        .from('articles')
        .select('*', { count: 'exact', head: true })
        .eq('is_read', false),
      
      // Recent crawl logs (last 5)
      client
        .from('crawl_logs')
        .select('id, status, started_at, finished_at, articles_found, articles_new, articles_matched, message')
        .order('started_at', { ascending: false })
        .limit(5),
    ])

    if (accError) throw accError
    if (artError) throw artError
    if (unreadError) throw unreadError
    if (logError) throw logError

    // Today's article count
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
        accountCount: accountCount || 0,
        articleCount: articleCount || 0,
        todayArticleCount: todayCount || 0,
        unreadCount: unreadCount || 0,
        recentLogs: logs || []
      }
    })
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
