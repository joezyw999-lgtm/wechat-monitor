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
    const client = getSupabaseServiceClient()
    const { data, error } = await client
      .from('accounts')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
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
