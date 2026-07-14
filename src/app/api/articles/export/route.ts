import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const session = await requireAuth(request)
    if (session instanceof Response) return session

    const { searchParams } = new URL(request.url)
    const keyword = searchParams.get('keyword') || ''
    const accountId = searchParams.get('accountId') || ''
    const category = searchParams.get('category') || ''
    const startDate = searchParams.get('startDate') || ''
    const endDate = searchParams.get('endDate') || ''
    const isRead = searchParams.get('isRead') || ''

    const client = getSupabaseServiceClient()
    const maxRows = 5000

    let query = client
      .from('articles')
      .select(`
        id,
        title,
        original_url,
        published_at,
        is_read,
        created_at,
        matched_keywords,
        summary,
        account_id,
        accounts!inner (
          name,
          category
        )
      `)
      .order('published_at', { ascending: false })
      .limit(maxRows)

    if (keyword) {
      query = query.or(`title.ilike.%${keyword}%,summary.ilike.%${keyword}%`)
    }
    if (accountId) {
      query = query.eq('account_id', accountId)
    }
    if (category) {
      query = query.eq('accounts.category', category)
    }
    if (startDate) {
      query = query.gte('published_at', startDate)
    }
    if (endDate) {
      query = query.lte('published_at', `${endDate} 23:59:59`)
    }
    if (isRead === 'true') {
      query = query.eq('is_read', true)
    } else if (isRead === 'false') {
      query = query.eq('is_read', false)
    }

    const { data, error } = await query

    if (error) throw error

    const rows = (data || []).map((item: any) => ({
      '标题': item.title || '',
      '公众号': item.accounts?.name || '',
      '分类': item.accounts?.category || '',
      '发布时间': item.published_at || '',
      '命中关键词': item.matched_keywords || '',
      '原文链接': item.original_url || '',
      '已读状态': item.is_read ? '已读' : '未读',
      '入库时间': item.created_at || '',
    }))

    const worksheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, '文章列表')

    // 设置列宽
    worksheet['!cols'] = [
      { wch: 50 },
      { wch: 20 },
      { wch: 10 },
      { wch: 20 },
      { wch: 20 },
      { wch: 60 },
      { wch: 10 },
      { wch: 20 },
    ]

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })

    const dateStr = new Date().toISOString().slice(0, 10)
    const filename = `文章列表_${dateStr}.xlsx`

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error.message || '导出失败' },
      { status: 500 }
    )
  }
}
