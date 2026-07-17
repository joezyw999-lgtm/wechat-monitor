import { NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { fetchAccountArticles, matchKeywords } from '@/lib/api-client'
import { filterAccountsByCrawlLimit, recordAccountCrawl, canAutoCrawlToday, isWeekend } from '@/lib/crawl-limit'
import { requireAuth } from '@/lib/auth'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(request: Request) {
  // CRON_SECRET 鉴权
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const client = getSupabaseServiceClient()

    // 先判断今天是否可以自动抓取
    if (!canAutoCrawlToday()) {
      const reason = isWeekend(new Date()) ? '周末' : '法定节假日'
      console.log(`[Cron Crawl] Skipped: ${reason}`)

      // 写一条跳过日志
      await client.from('crawl_logs').insert({
        status: 'skipped',
        message: `${reason}，自动抓取跳过`,
        accounts_crawled: 0,
        articles_found: 0,
        articles_new: 0,
        articles_matched: 0,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })

      return NextResponse.json({
        success: true,
        skipped: true,
        reason,
      })
    }

    // Get settings
    const { data: settingsData } = await client
      .from('settings')
      .select('key, value')

    const settings: Record<string, string> = {}
    settingsData?.forEach((s: any) => {
      settings[s.key] = s.value
    })

    const apiKey = settings.oneapi_key || process.env.ONEAPI_API_KEY || ''
    const articleCount = parseInt(settings.article_count || '10', 10)

    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'API Key 未配置' },
        { status: 400 }
      )
    }

    // Get active accounts
    const { data: accounts } = await client
      .from('accounts')
      .select('id, name, wx_id')
      .eq('status', 'active')

    if (!accounts || accounts.length === 0) {
      return NextResponse.json(
        { success: false, error: '没有启用的公众号' },
        { status: 400 }
      )
    }

    // 按频率限制过滤公众号
    const { allowedAccounts: finalAccounts, skipReason } = await filterAccountsByCrawlLimit(
      accounts,
      client
    )

    if (skipReason.weeklyLimit > 0) {
      console.log(`[Cron Crawl] Skipped ${skipReason.weeklyLimit} accounts by weekly limit`)
    }

    if (finalAccounts.length === 0) {
      await client.from('crawl_logs').insert({
        status: 'skipped',
        message: '所有公众号本周已达抓取次数上限',
        accounts_crawled: 0,
        articles_found: 0,
        articles_new: 0,
        articles_matched: 0,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })

      return NextResponse.json({
        success: true,
        skipped: true,
        reason: '所有公众号本周已达抓取次数上限',
        accountsTotal: accounts.length,
      })
    }

    // Get active keywords
    const { data: keywordsData } = await client
      .from('keywords')
      .select('word')
      .eq('status', 'active')
    const keywords = keywordsData?.map((k: any) => k.word) || []

    // Create crawl log
    const { data: logData } = await client
      .from('crawl_logs')
      .insert({ status: 'running', message: 'Cron job started', keywords_used: null })
      .select()
      .single()

    let totalFound = 0
    let totalSkippedOld = 0
    let totalNew = 0
    let totalMatched = 0
    let totalDedupSkipped = 0
    let totalFailed = 0
    const errors: string[] = []

    // 4-day cutoff for article freshness
    const cutoffTime = Date.now() - 4 * 24 * 60 * 60 * 1000

    // Collect all articles from all accounts first (after keyword + time filter)
    const allArticles: Array<{
      account: any
      article: any
      matchedKw: string[]
    }> = []

    // Crawl each account and collect articles
    for (const account of finalAccounts) {
      const result = await fetchAccountArticles(apiKey, account.wx_id, articleCount)

      if (!result.success) {
        totalFailed++
        errors.push(`${account.name}: ${result.error}`)
        continue
      }

      console.log(`[Cron Crawl] Account ${account.name} (${account.wx_id}): API returned ${result.articles.length} articles`)
      totalFound += result.articles.length

      for (const article of result.articles) {
        if (!article.published_at) {
          console.log(`[Cron Crawl] Skipping (no publish time): ${article.title}`)
          continue
        }

        const pubTime = new Date(article.published_at).getTime()
        if (isNaN(pubTime) || pubTime < cutoffTime) {
          console.log(`[Cron Crawl] Skipping (too old): ${article.title}`)
          totalSkippedOld++
          continue
        }

        const matchedKw = matchKeywords(article.title, article.digest || '', keywords)
        
        if (matchedKw.length === 0) {
          console.log(`[Cron Crawl] Skipping (no keyword match): ${article.title}`)
          continue
        }

        allArticles.push({ account, article, matchedKw })
      }
    }

    totalMatched = allArticles.length

    // 基础去重：按 original_url 去重（采集阶段只做 URL 级别的基础去重）
    const allUrls = allArticles.map(a => a.article.url).filter(Boolean)
    let existingUrls = new Set<string>()

    const batchSize = 100

    if (allUrls.length > 0) {
      for (let i = 0; i < allUrls.length; i += batchSize) {
        const batch = allUrls.slice(i, i + batchSize)
        const { data: existing } = await client
          .from('articles')
          .select('original_url')
          .in('original_url', batch)

        if (existing) {
          existing.forEach((e: any) => existingUrls.add(e.original_url))
        }
      }
    }

    console.log(`[Cron Crawl] Found ${existingUrls.size} existing URLs`)

    const newArticles = allArticles.filter(a => !existingUrls.has(a.article.url))

    totalDedupSkipped = allArticles.length - newArticles.length
    console.log(`[Cron Crawl] ${newArticles.length} new articles to insert (after URL dedup), skipped ${totalDedupSkipped} by dedup`)

    // Batch insert new articles (clean_status = pending, 等待手动清洗)
    if (newArticles.length > 0) {
      const insertData = newArticles.map(a => ({
        account_id: a.account.id,
        title: a.article.title,
        original_title: a.article.title,
        original_url: a.article.url,
        summary: a.article.digest || null,
        content: a.article.content || null,
        published_at: a.article.published_at || new Date().toISOString(),
        unique_key: a.article.msg_id || null,
        matched_keywords: a.matchedKw.join(','),
        clean_status: 'pending',
      }))

      const insertBatchSize = 50
      for (let i = 0; i < insertData.length; i += insertBatchSize) {
        const batch = insertData.slice(i, i + insertBatchSize)
        const { error: insertError } = await client
          .from('articles')
          .insert(batch)

        if (insertError) {
          console.error(`[Cron Crawl] Batch insert error:`, insertError.message)
          errors.push(`Batch insert error: ${insertError.message}`)
        } else {
          totalNew += batch.length
          console.log(`[Cron Crawl] Inserted batch of ${batch.length} articles`)
          batch.forEach(item => {
            if (item.original_url) existingUrls.add(item.original_url)
          })
        }
      }
    }

    const { error: updateLogError } = await client
      .from('crawl_logs')
      .update({
        status: totalFailed > 0 || errors.length > 0 ? 'partial' : 'success',
        message: errors.length > 0 ? errors.join('; ') : null,
        accounts_crawled: finalAccounts.length,
        articles_found: totalMatched,
        articles_new: totalNew,
        articles_matched: totalMatched,
        finished_at: new Date().toISOString(),
      })
      .eq('id', logData.id)

    if (updateLogError) throw updateLogError

    // 记录本次自动抓取的公众号，用于周次数统计
    await recordAccountCrawl(finalAccounts.map((a: any) => a.id), client)

    // 清理超过4天的历史文章
    const cutoffDate = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString()
    const { error: cleanupError } = await client
      .from('articles')
      .delete()
      .lt('published_at', cutoffDate)
    if (cleanupError) {
      console.error('[Cron Crawl] Cleanup old articles error:', cleanupError.message)
    }

    return NextResponse.json({
      success: true,
      totalFound,
      totalNew,
      totalMatched,
      totalFailed,
      accountsCrawled: finalAccounts.length,
      accountsTotal: accounts.length,
      skippedByLimit: accounts.length - finalAccounts.length,
    })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
