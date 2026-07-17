import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import * as XLSX from 'xlsx'

const VALID_CATEGORIES = ['官方', '高校', '竞对'] as const

export async function POST(request: NextRequest) {
  const session = await requireAuth(request)
  if (session instanceof Response) return session

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    if (!file) {
      return NextResponse.json({ success: false, message: '请上传文件' }, { status: 400 })
    }

    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer)
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' })

    const total = rows.length
    const successList: any[] = []
    const skipped: string[] = []
    const failures: { row: number; reason: string }[] = []

    // 提取所有 wx_id 用于去重检查
    const wxIdSet = new Set<string>()
    const validAccounts: any[] = []

    rows.forEach((row, index) => {
      const rowNum = index + 2 // Excel 行号，表头是第1行

      // 兼容中英文表头
      const name = (row['公众号名称'] || row['name'] || '').toString().trim()
      const wxId = (row['原始ID'] || row['wx_id'] || row['wxId'] || '').toString().trim()
      let category = (row['分类'] || row['category'] || '官方').toString().trim()
      let status = (row['状态'] || row['status'] || '').toString().trim()
      if (!status) status = 'active'

      // 校验必填
      if (!name) {
        failures.push({ row: rowNum, reason: '公众号名称不能为空' })
        return
      }
      if (!wxId) {
        failures.push({ row: rowNum, reason: '原始ID不能为空' })
        return
      }

      // 校验分类
      if (!VALID_CATEGORIES.includes(category as any)) {
        failures.push({ row: rowNum, reason: `分类不合法：${category}，只能是：${VALID_CATEGORIES.join('、')}` })
        return
      }

      // 状态兼容
      if (status === '启用' || status === 'active') status = 'active'
      else if (status === '禁用' || status === 'inactive') status = 'inactive'

      // 文件内去重
      if (wxIdSet.has(wxId)) {
        skipped.push(`第${rowNum}行：${name}（原始ID重复）`)
        return
      }
      wxIdSet.add(wxId)

      validAccounts.push({ name, wx_id: wxId, category, status })
    })

    if (validAccounts.length === 0) {
      return NextResponse.json({
        success: false,
        message: '没有有效的数据',
        data: {
          total,
          success: 0,
          skipped: skipped.length,
          failed: failures.length,
          failures,
          skipped_list: skipped
        }
      }, { status: 400 })
    }

    // 查询数据库中已存在的 wx_id
    const client = getSupabaseServiceClient()
    const wxIds = validAccounts.map(a => a.wx_id)
    const { data: existing } = await client
      .from('accounts')
      .select('wx_id')
      .in('wx_id', wxIds)

    const existingWxIds = new Set((existing || []).map((a: any) => a.wx_id))

    // 过滤掉已存在的
    const newAccounts = validAccounts.filter(a => {
      if (existingWxIds.has(a.wx_id)) {
        skipped.push(`${a.name}（已存在）`)
        return false
      }
      return true
    })

    // 批量插入
    if (newAccounts.length > 0) {
      const batchSize = 50
      for (let i = 0; i < newAccounts.length; i += batchSize) {
        const batch = newAccounts.slice(i, i + batchSize)
        const { error } = await client.from('accounts').insert(batch)
        if (error) throw error
        successList.push(...batch)
      }
    }

    return NextResponse.json({
      success: true,
      message: `导入完成：成功 ${successList.length} 条，跳过 ${skipped.length} 条，失败 ${failures.length} 条`,
      data: {
        total,
        success: successList.length,
        skipped: skipped.length,
        failed: failures.length,
        failures,
        skipped_list: skipped
      }
    })
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 })
  }
}
