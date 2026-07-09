import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function GET() {
  try {
    const client = getSupabaseServiceClient()
    const { data, error } = await client
      .from('keywords')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return NextResponse.json({ success: true, data: data || [] })
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const client = getSupabaseServiceClient() as any
    const { data, error } = await client
      .from('keywords')
      .insert({
        keyword: body.keyword,
        group_name: body.groupName || null,
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
  try {
    const body = await request.json()
    const client = getSupabaseServiceClient() as any
    const { data, error } = await client
      .from('keywords')
      .update({
        keyword: body.keyword,
        group_name: body.groupName || null,
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
