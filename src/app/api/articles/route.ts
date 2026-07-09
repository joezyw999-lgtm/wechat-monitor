import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')
    const keyword = searchParams.get('keyword')
    const accountId = searchParams.get('accountId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const isRead = searchParams.get('isRead')

    const client = getSupabaseClient()
    let query = client
      .from('articles')
      .select('*', { count: 'exact' })
      .order('published_at', { ascending: false })

    if (keyword) {
      query = query.or(`title.ilike.%${keyword}%,summary.ilike.%${keyword}%`)
    }
    if (accountId) {
      query = query.eq('account_id', accountId)
    }
    if (startDate) {
      query = query.gte('published_at', startDate)
    }
    if (endDate) {
      query = query.lte('published_at', endDate)
    }
    if (isRead !== null && isRead !== undefined) {
      query = query.eq('is_read', isRead === 'true')
    }

    const from = (page - 1) * pageSize
    const to = from + pageSize - 1
    query = query.range(from, to)

    const { data, error, count } = await query
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

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const client = getSupabaseClient() as any
    const { data, error } = await client
      .from('articles')
      .update({ is_read: body.isRead, updated_at: new Date().toISOString() })
      .eq('id', body.id)
      .select()
      .single()
    if (error) throw error
    return NextResponse.json({ success: true, data })
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
