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
    const keyword = searchParams.get('keyword')
    const accountId = searchParams.get('accountId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const isRead = searchParams.get('isRead')

    const client = getSupabaseServiceClient()

    // 翻页时跳过 count，只有第一页或筛选变化时才统计总数
    const needCount = page === 1
    const selectFields = 'id,title,account_name,published_at,is_read,created_at,matched_keywords,summary,original_url'

    let query = client
      .from('articles')
      .select(selectFields, needCount ? { count: 'exact' } : undefined)
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
      query = query.lte('published_at', `${endDate} 23:59:59`)
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
        total: count ?? null,
        page,
        pageSize
      }
    })
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const session = await requireAuth(request)
  if (session instanceof Response) return session

  try {
    const body = await request.json()
    const ids = body.ids

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { success: false, message: '请选择要删除的文章' },
        { status: 400 }
      )
    }

    const client = getSupabaseServiceClient()
    const { error } = await client
      .from('articles')
      .delete()
      .in('id', ids)

    if (error) throw error

    return NextResponse.json({
      success: true,
      data: { deleted: ids.length }
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error.message || '删除失败' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  const session = await requireAuth(request)
  if (session instanceof Response) return session

  try {
    const body = await request.json()
    const client = getSupabaseServiceClient()

    // 批量标记已读
    if (body.markAll) {
      const filters = body.filters || {}
      let query = client.from('articles').update({ is_read: body.isRead, updated_at: new Date().toISOString() })

      if (filters.keyword) {
        query = query.or(`title.ilike.%${filters.keyword}%,summary.ilike.%${filters.keyword}%`)
      }
      if (filters.accountId) {
        query = query.eq('account_id', filters.accountId)
      }
      if (filters.startDate) {
        query = query.gte('published_at', filters.startDate)
      }
      if (filters.endDate) {
        query = query.lte('published_at', `${filters.endDate} 23:59:59`)
      }
      if (filters.isRead !== undefined && filters.isRead !== null && filters.isRead !== '') {
        query = query.eq('is_read', filters.isRead === 'true' || filters.isRead === true)
      }

      const { error } = await query.select('id')
      if (error) throw error
      const updated = (query as any).count || 0

      return NextResponse.json({ success: true, data: { updated } })
    }

    // 单篇更新
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
