import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'

export const VALID_CATEGORIES = ['官方', '高校', '竞对'] as const
export type AccountCategory = (typeof VALID_CATEGORIES)[number]

function isValidCategory(cat: string | undefined): cat is AccountCategory {
  return VALID_CATEGORIES.includes(cat as AccountCategory)
}

export async function GET(request: NextRequest) {
  const session = await requireAuth(request)
  if (session instanceof Response) return session

  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')
    const keyword = searchParams.get('keyword') || ''
    const category = searchParams.get('category') || ''
    const status = searchParams.get('status') || ''

    // 兼容旧版：不传分页参数时返回全部（供文章列表筛选下拉等使用）
    const hasPagination = searchParams.has('page') || searchParams.has('pageSize')

    const client = getSupabaseServiceClient()

    const needCount = page === 1
    const selectStr = hasPagination
      ? 'id,name,wx_id,category,status,created_at,updated_at'
      : '*'

    let query = client
      .from('accounts')
      .select(selectStr, hasPagination && needCount ? { count: 'exact' } : undefined)
      .order('created_at', { ascending: false })

    if (keyword) {
      query = query.or(`name.ilike.%${keyword}%,wx_id.ilike.%${keyword}%`)
    }
    if (category) {
      query = query.eq('category', category)
    }
    if (status) {
      query = query.eq('status', status)
    }

    let data: any[] | null
    let count: number | null = null

    if (hasPagination) {
      const from = (page - 1) * pageSize
      const to = from + pageSize - 1
      query = query.range(from, to)
      const result = await query
      if (result.error) throw result.error
      data = result.data
      count = result.count ?? null
    } else {
      const result = await query
      if (result.error) throw result.error
      data = result.data
    }

    if (hasPagination) {
      return NextResponse.json({
        success: true,
        data: {
          list: data || [],
          total: count,
          page,
          pageSize,
        }
      })
    }

    return NextResponse.json({ success: true, data: data || [] })
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const session = await requireAuth(request)
  if (session instanceof Response) return session

  try {
    const body = await request.json()
    const category = body.category || '官方'
    if (!isValidCategory(category)) {
      return NextResponse.json({ success: false, message: '分类只能是：官方、高校、竞对' }, { status: 400 })
    }
    const client = getSupabaseServiceClient() as any
    const { data, error } = await client
      .from('accounts')
      .insert({
        name: body.name,
        wx_id: body.wx_id || body.bizId || body.wxId,
        status: body.status || 'active',
        category
      })
      .select()
      .single()
    if (error) throw error
    return NextResponse.json({ success: true, data })
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const session = await requireAuth(request)
  if (session instanceof Response) return session

  try {
    const body = await request.json()
    const category = body.category
    if (category !== undefined && !isValidCategory(category)) {
      return NextResponse.json({ success: false, message: '分类只能是：官方、高校、竞对' }, { status: 400 })
    }
    const client = getSupabaseServiceClient() as any
    const updateData: Record<string, any> = {
      name: body.name,
      wx_id: body.wx_id || body.bizId || body.wxId,
      status: body.status,
      updated_at: new Date().toISOString()
    }
    if (category !== undefined) updateData.category = category
    const { data, error } = await client
      .from('accounts')
      .update(updateData)
      .eq('id', body.id)
      .select()
      .single()
    if (error) throw error
    return NextResponse.json({ success: true, data })
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const session = await requireAuth(request)
  if (session instanceof Response) return session

  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ success: false, message: 'Missing id' }, { status: 400 })
    const client = getSupabaseServiceClient()
    const { error } = await client
      .from('accounts')
      .delete()
      .eq('id', id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
