import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { signSession, getSessionCookieHeader } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json()
    const client = getSupabaseServiceClient() as any

    if (!username || !password) {
      return NextResponse.json(
        { success: false, message: '用户名和密码不能为空' },
        { status: 400 }
      )
    }

    const { data, error } = await client
      .from('users')
      .select('id, username, password_hash, status')
      .eq('username', username)
      .maybeSingle()

    if (error) throw error

    // 如果用户不存在，检查是否是首次登录（无用户时自动创建 admin）
    if (!data) {
      const { data: allUsers } = await client
        .from('users')
        .select('id')
        .limit(1)

      if (!allUsers || allUsers.length === 0) {
        // 首次使用，创建默认管理员
        const hashedPassword = bcrypt.hashSync(password, 10)
        const { data: newUser, error: createError } = await client
          .from('users')
          .insert({
            username,
            password_hash: hashedPassword,
            status: 'active',
            role: 'admin'
          })
          .select('id, username, status')
          .single()

        if (createError) throw createError

        const token = await signSession({ username: newUser.username })
        const cookieHeader = getSessionCookieHeader(token)

        return NextResponse.json(
          { success: true, data: { id: newUser.id, username: newUser.username } },
          { headers: { 'Set-Cookie': cookieHeader } }
        )
      }

      return NextResponse.json(
        { success: false, message: '用户名或密码错误' },
        { status: 401 }
      )
    }

    // 检查密码
    const passwordMatch = bcrypt.compareSync(password, data.password_hash)
    if (!passwordMatch) {
      return NextResponse.json(
        { success: false, message: '用户名或密码错误' },
        { status: 401 }
      )
    }

    if (data.status !== 'active') {
      return NextResponse.json(
        { success: false, message: '账号已禁用' },
        { status: 403 }
      )
    }

    const token = await signSession({ username: data.username })
    const cookieHeader = getSessionCookieHeader(token)

    return NextResponse.json(
      { success: true, data: { id: data.id, username: data.username } },
      { headers: { 'Set-Cookie': cookieHeader } }
    )
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    )
  }
}
