import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { cleanArticlesWithLLM } from '@/lib/llm-clean'

export const runtime = 'nodejs'
export const maxDuration = 300

// 清洗文章：调用 LLM 生成标准标题、去重 key、公司名等
// 请求体：{ ids?: string[] } 不传则清洗所有 pending 的文章
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request)
    if (session instanceof Response) return session

    const body = await request.json().catch(() => ({}))
    const ids: string[] | undefined = body.ids

    const client = getSupabaseServiceClient()

    // 获取 LLM 配置（配置了 API 地址和 Key 才算启用）
    const { data: settingsData } = await client
      .from('settings')
      .select('key, value')

    const settings: Record<string, string> = {}
    settingsData?.forEach((s: any) => {
      settings[s.key] = s.value
    })

    const llmBaseUrl = settings.llm_api_base || ''
    const llmApiKey = settings.llm_api_key || ''
    const llmBatchSize = parseInt(settings.llm_batch_size || '15', 10)

    if (!llmBaseUrl || !llmApiKey) {
      return NextResponse.json(
        { success: false, message: '请先在系统设置中配置 LLM API 地址和 Key' },
        { status: 400 }
      )
    }

    // 查询待清洗的文章
    let query = client
      .from('articles')
      .select('id, title, original_title, summary, original_url, published_at')
      .eq('clean_status', 'pending')

    if (ids && ids.length > 0) {
      query = query.in('id', ids)
    }

    const { data: pendingArticles, error: fetchError } = await query
      .order('published_at', { ascending: false })
      .limit(200) // 单次最多处理 200 篇，避免超时

    if (fetchError) throw fetchError

    if (!pendingArticles || pendingArticles.length === 0) {
      return NextResponse.json({
        success: true,
        data: { cleaned: 0, duplicates: 0, failed: 0, total: 0, message: '没有待清洗的文章' },
      })
    }

    const total = pendingArticles.length

    // 分批次调用 LLM
    let cleanedCount = 0
    let duplicateCount = 0
    let failedCount = 0
    const errors: string[] = []

    for (let i = 0; i < pendingArticles.length; i += llmBatchSize) {
      const batch = pendingArticles.slice(i, i + llmBatchSize)

      // 调用 LLM 批量清洗
      const llmResults = await cleanArticlesWithLLM(
        batch.map(a => ({
          title: a.original_title || a.title,
          summary: a.summary || '',
          original_url: a.original_url || '',
          published_at: a.published_at || '',
        })),
        llmBatchSize,
      )

      // 收集本批次需要更新和去重的文章
      const cleanedArticles: Array<{
        id: string
        standard_title: string | null
        dedup_key: string | null
        company_name: string | null
        recruit_type: string | null
        recruit_batch: string | null
      }> = []

      const failedIds: string[] = []
      const failedErrors: string[] = []

      batch.forEach((article, idx) => {
        const result = llmResults[idx]
        if (!result) {
          failedIds.push(article.id)
          failedErrors.push(`${article.title}: LLM 调用失败`)
          return
        }
        cleanedArticles.push({
          id: article.id,
          standard_title: result.standard_title || null,
          dedup_key: result.dedup_key || null,
          company_name: result.company_name || null,
          recruit_type: result.recruit_type || null,
          recruit_batch: result.recruit_batch || null,
        })
      })

      failedCount += failedIds.length
      if (failedErrors.length > 0) {
        errors.push(...failedErrors)
      }

      // 批量更新失败的文章
      if (failedIds.length > 0) {
        try {
          await client
            .from('articles')
            .update({
              clean_status: 'failed',
              clean_error: 'LLM 调用失败',
              cleaned_at: new Date().toISOString(),
            })
            .in('id', failedIds)
        } catch (e: any) {
          console.error('[Clean] Update failed articles error:', e.message)
        }
      }

      // 去重处理：检查 dedup_key 和 standard_title
      if (cleanedArticles.length > 0) {
        const allDedupKeys = cleanedArticles.map(a => a.dedup_key).filter(Boolean) as string[]
        const allStdTitles = cleanedArticles.map(a => a.standard_title).filter(Boolean) as string[]

        // 查询数据库中已存在的 dedup_key 和 standard_title
        let existingDedupKeys = new Set<string>()
        let existingStdTitles = new Set<string>()

        if (allDedupKeys.length > 0) {
          const { data: existingDedup } = await client
            .from('articles')
            .select('id, dedup_key')
            .in('dedup_key', allDedupKeys)
            .neq('clean_status', 'duplicate')

          existingDedup?.forEach((e: any) => {
            if (e.dedup_key) existingDedupKeys.add(e.dedup_key)
          })
        }

        if (allStdTitles.length > 0) {
          const { data: existingStd } = await client
            .from('articles')
            .select('id, standard_title')
            .in('standard_title', allStdTitles)
            .neq('clean_status', 'duplicate')

          existingStd?.forEach((e: any) => {
            if (e.standard_title) existingStdTitles.add(e.standard_title)
          })
        }

        // 分批判断本批次内是否有重复
        const batchDedupMap = new Map<string, string>() // dedup_key/title -> first article id
        const duplicateIds: string[] = []
        const duplicateOf: Record<string, string> = {}
        const nonDuplicate: typeof cleanedArticles = []

        for (const article of cleanedArticles) {
          let isDup = false
          let dupOf = ''

          // 检查 dedup_key
          if (article.dedup_key) {
            if (existingDedupKeys.has(article.dedup_key) || batchDedupMap.has(`dk:${article.dedup_key}`)) {
              isDup = true
              dupOf = batchDedupMap.get(`dk:${article.dedup_key}`) || ''
            } else {
              batchDedupMap.set(`dk:${article.dedup_key}`, article.id)
            }
          }

          // 检查 standard_title
          if (!isDup && article.standard_title) {
            if (existingStdTitles.has(article.standard_title) || batchDedupMap.has(`st:${article.standard_title}`)) {
              isDup = true
              dupOf = batchDedupMap.get(`st:${article.standard_title}`) || ''
            } else {
              batchDedupMap.set(`st:${article.standard_title}`, article.id)
            }
          }

          if (isDup) {
            duplicateIds.push(article.id)
            if (dupOf) duplicateOf[article.id] = dupOf
          } else {
            nonDuplicate.push(article)
            if (article.dedup_key) existingDedupKeys.add(article.dedup_key)
            if (article.standard_title) existingStdTitles.add(article.standard_title)
          }
        }

        // 标记重复文章（直接删除）
        if (duplicateIds.length > 0) {
          const { error: delError } = await client
            .from('articles')
            .delete()
            .in('id', duplicateIds)

          if (delError) {
            console.error('[Clean] Delete duplicates error:', delError.message)
            errors.push(`删除重复文章失败: ${delError.message}`)
          } else {
            duplicateCount += duplicateIds.length
            console.log(`[Clean] Deleted ${duplicateIds.length} duplicate articles`)
          }
        }

        // 更新非重复文章
        if (nonDuplicate.length > 0) {
          const { error: updateError } = await client
            .from('articles')
            .update({
              clean_status: 'cleaned',
              cleaned_at: new Date().toISOString(),
            })
            .in('id', nonDuplicate.map(a => a.id))

          if (updateError) {
            console.error('[Clean] Update cleaned status error:', updateError.message)
            errors.push(`更新清洗状态失败: ${updateError.message}`)
          } else {
            // 再逐条更新详细字段
            for (const article of nonDuplicate) {
              await client
                .from('articles')
                .update({
                  standard_title: article.standard_title,
                  title: article.standard_title || undefined,
                  dedup_key: article.dedup_key,
                  company_name: article.company_name,
                  recruit_type: article.recruit_type,
                  recruit_batch: article.recruit_batch,
                })
                .eq('id', article.id)
            }
            cleanedCount += nonDuplicate.length
            console.log(`[Clean] Cleaned ${nonDuplicate.length} articles`)
          }
        }
      }

      console.log(`[Clean] Batch ${Math.floor(i / llmBatchSize) + 1} done: ${batch.length} articles`)
    }

    return NextResponse.json({
      success: true,
      data: {
        total,
        cleaned: cleanedCount,
        duplicates: duplicateCount,
        failed: failedCount,
        errors: errors.slice(0, 20),
      },
    })
  } catch (error: any) {
    console.error('[Clean API] Error:', error)
    return NextResponse.json(
      { success: false, message: error.message || '清洗失败' },
      { status: 500 }
    )
  }
}
