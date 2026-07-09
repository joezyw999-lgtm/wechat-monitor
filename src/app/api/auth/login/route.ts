import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json()
    const client = getSupabaseServiceClient() as any

    const { data, error } = await client
      .from('users')
      .select('id, username, password_hash, status')
      .eq('username', username)
      .maybeSingle()

    if (error) throw error
    if (!data) {
      return NextResponse.json({ success: false, message: '用户名或密码错误' }, { status: 401 })
    }

    if (data.password_hash !== password) {
      return NextResponse.json({ success: false, message: '用户名或密码错误' }, { status: 401 })
    }

    if (data.status !== 'active') {
      return NextResponse.json({ success: false, message: '账号已禁用' }, { status: 403 })
    }

    return NextResponse.json({
      success: true,
      data: { id: data.id, username: data.username }
    })
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
