import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const session = await requireAuth(request)
  if (session instanceof Response) return session

  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    const page = parseInt(searchParams.get('page') || '1', 10)
    const pageSize = parseInt(searchParams.get('pageSize') || '100', 10)
    const client = getSupabaseServiceClient()
    let query = client
      .from('keywords')
      .select('*', { count: 'exact' })
    if (type) {
      // 包含关键词：type = 'include' 或 type IS NULL（兼容历史数据）
      if (type === 'include') {
        query = query.or('type.eq.include,type.is.null')
      } else {
        query = query.eq('type', type)
      }
    }
    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1)
    if (error) throw error
    return NextResponse.json({
      success: true,
      data: { list: data || [], total: count || 0, page, pageSize }
    })
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const session = await requireAuth(request)
  if (session instanceof Response) return session

  try {
    const body = await request.json()
    const client = getSupabaseServiceClient() as any
    const { data, error } = await client
      .from('keywords')
      .insert({
        word: body.word || body.keyword,
        group_name: body.groupName || body.group_name || null,
        type: body.type || 'include',
        status: body.status || 'active'
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
    const client = getSupabaseServiceClient() as any
    const { data, error } = await client
      .from('keywords')
      .update({
        word: body.word || body.keyword,
        group_name: body.groupName || body.group_name || null,
        status: body.status,
        updated_at: new Date().toISOString()
      })
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
      .from('keywords')
      .delete()
      .eq('id', id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
