import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'

export async function GET() {
  try {
    const client = getSupabaseServiceClient() as any
    const { data, error } = await client
      .from('settings')
      .select('*')
    if (error) throw error

    const settings: Record<string, string> = {}
    const sensitiveKeys = ['api_key', 'oneapi_key']
    for (const item of data || []) {
      if (sensitiveKeys.includes(item.key) && item.value) {
        // Mask sensitive values: show first 6 and last 4 chars
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
  try {
    const body = await request.json()
    const client = getSupabaseServiceClient() as any

    for (const [key, value] of Object.entries(body)) {
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
