import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')

    const client = getSupabaseServiceClient()
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1

    const { data, error, count } = await client
      .from('crawl_logs')
      .select('*', { count: 'exact' })
      .order('started_at', { ascending: false })
      .range(from, to)

    if (error) throw error

    return NextResponse.json({
      success: true,
      data: {
        list: data || [],
        total: count || 0,
        page,
        pageSize
      }
    })
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
