import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const session = await requireAuth(request)
  if (session instanceof Response) return session

  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')

    const client = getSupabaseServiceClient()
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1

    const { data, error } = await client
      .from('crawl_logs')
      .select('id,status,started_at,finished_at,accounts_crawled,articles_found,articles_matched,articles_new,message')
      .order('started_at', { ascending: false })
      .range(from, to)

    if (error) throw error

    return NextResponse.json({
      success: true,
      data: {
        list: data || [],
        total: null,
        page,
        pageSize,
        hasMore: (data?.length || 0) >= pageSize,
      }
    })
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
