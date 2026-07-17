import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'

const ALLOWED_KEYS = [
  'api_key',
  'oneapi_key',
  'article_count',
  'cron_expression',
  'llm_api_base',
  'llm_api_key',
  'llm_model',
  'llm_batch_size',
]

export async function GET(request: NextRequest) {
  const session = await requireAuth(request)
  if (session instanceof Response) return session

  try {
    const client = getSupabaseServiceClient() as any
    const { data, error } = await client
      .from('settings')
      .select('*')
    if (error) throw error

    const settings: Record<string, string> = {}
    const sensitiveKeys = ['api_key', 'oneapi_key', 'llm_api_key']
    for (const item of data || []) {
      if (sensitiveKeys.includes(item.key) && item.value) {
        const v = item.value as string
        settings[item.key] = v.length > 10
          ? v.slice(0, 6) + '****' + v.slice(-4)
          : '****'
      } else {
        settings[item.key] = item.value
      }
    }

    return NextResponse.json({ success: true, data: settings })
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

    for (const [key, value] of Object.entries(body)) {
      if (!ALLOWED_KEYS.includes(key)) {
        return NextResponse.json(
          { success: false, message: `不允许修改的配置项: ${key}` },
          { status: 400 }
        )
      }

      // 跳过掩码值（用户没改密码）
      if (
        (key === 'api_key' || key === 'oneapi_key' || key === 'llm_api_key') &&
        typeof value === 'string' &&
        value.includes('****')
      ) {
        continue
      }

      // 类型校验
      if (key === 'article_count') {
        const num = Number(value)
        if (isNaN(num) || num < 1 || num > 100) {
          return NextResponse.json(
            { success: false, message: '采集数量必须是 1-100 之间的整数' },
            { status: 400 }
          )
        }
      }

      const { error } = await client
        .from('settings')
        .upsert(
          { key: key, value: value as string, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        )
      if (error) throw error
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
