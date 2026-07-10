import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import axios from 'axios'

const API_BASE = 'https://api.getoneapi.com'

// Get account balance
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') || 'balance' // balance | usage

    const client = getSupabaseServiceClient() as any

    // Get API key from settings
    const { data: settingsData } = await client
      .from('settings')
      .select('key, value')
      .in('key', ['api_key', 'oneapi_key'])

    const settingsMap = new Map<string, string>(
      settingsData?.map((s: any) => [s.key, s.value]) || []
    )
    const apiKey = settingsMap.get('oneapi_key') || settingsMap.get('api_key')

    if (!apiKey) {
      return NextResponse.json(
        { success: false, message: '请先在系统设置中配置 OneAPI Key' },
        { status: 400 }
      )
    }

    if (type === 'balance') {
      // Fetch balance from getoneapi.com
      const response = await axios.post(
        `${API_BASE}/back/user/balance`,
        {},
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: 30000,
        }
      )

      if (response.data.code === 200) {
        return NextResponse.json({
          success: true,
          data: response.data.data,
        })
      } else {
        return NextResponse.json(
          { success: false, message: response.data.message || '获取余额失败' },
          { status: 400 }
        )
      }
    } else if (type === 'usage') {
      // Fetch usage records
      let startDate = searchParams.get('startDate')
      let endDate = searchParams.get('endDate')

      if (!startDate || !endDate) {
        // Default to last 30 days
        const end = new Date()
        const start = new Date()
        start.setDate(start.getDate() - 30)
        startDate = start.toISOString().split('T')[0]
        endDate = end.toISOString().split('T')[0]
      }

      const response = await axios.post(
        `${API_BASE}/back/user/usage_record`,
        { startDate, endDate },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: 30000,
        }
      )

      if (response.data.code === 200) {
        return NextResponse.json({
          success: true,
          data: response.data.data || [],
          startDate,
          endDate,
        })
      } else {
        return NextResponse.json(
          { success: false, message: response.data.message || '获取使用记录失败' },
          { status: 400 }
        )
      }
    }

    return NextResponse.json(
      { success: false, message: 'Invalid type parameter' },
      { status: 400 }
    )
  } catch (error: any) {
    console.error('[Balance API] Error:', error.message)
    return NextResponse.json(
      { success: false, message: error.message || '请求失败' },
      { status: 500 }
    )
  }
}
