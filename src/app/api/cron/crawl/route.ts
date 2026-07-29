import { NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { fetchAccountArticles, matchKeywords } from '@/lib/api-client'
import { filterAccountsByCrawlLimit, recordAccountCrawl, canAutoCrawlToday, isWeekend } from '@/lib/crawl-limit'

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

    console.log(`[Cron Crawl] Starting crawl: ${finalAccounts.length} accounts (total active: ${accounts.length}, skipped by limit: ${skipReason.weeklyLimit})`)

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

    // Counters
    let totalFound = 0
    let totalSkippedOld = 0
    let totalNew = 0
    let totalMatched = 0
    let totalDedupSkipped = 0
    let totalFailed = 0
    let accountsProcessed = 0
    const errors: string[] = []
    const successAccountIds: string[] = []

    // 4-day cutoff for article freshness
    const now = Date.now()
    const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000
    const cutoffTime = now - FOUR_DAYS_MS

    // Process each account individually: fetch -> filter -> dedup -> insert
    for (const account of finalAccounts) {
      accountsProcessed++

      try {
        // 1. Fetch articles from API
        const result = await fetchAccountArticles(apiKey, account.wx_id, articleCount)

        if (!result.success) {
          totalFailed++
          errors.push(`${account.name}: ${result.error}`)
          console.log(`[Cron Crawl] [${accountsProcessed}/${finalAccounts.length}] ${account.name} FAILED: ${result.error}`)
          // Still update last_crawled_at
          await client
            .from('accounts')
            .update({ last_crawled_at: new Date().toISOString() })
            .eq('id', account.id)
          continue
        }

        console.log(`[Cron Crawl] [${accountsProcessed}/${finalAccounts.length}] ${account.name}: API returned ${result.articles.length} articles`)
        totalFound += result.articles.length

        // 2. Filter by publish time and match keywords
        const matchedArticles: Array<{ article: any; matchedKw: string[] }> = []
        for (const article of result.articles) {
          const pubTime = article.published_at || article.publish_time
          if (!pubTime) continue

          const timestamp = typeof pubTime === 'number' ? pubTime * 1000 : new Date(pubTime).getTime()
          if (isNaN(timestamp) || timestamp < cutoffTime) {
            totalSkippedOld++
            continue
          }

          const matchedKw = matchKeywords(article.title, article.digest || '', keywords)
          if (matchedKw.length === 0) continue

          matchedArticles.push({ article, matchedKw })
        }

        totalMatched += matchedArticles.length

        if (matchedArticles.length === 0) {
          await client
            .from('accounts')
            .update({ last_crawled_at: new Date().toISOString() })
            .eq('id', account.id)
          successAccountIds.push(account.id)

          // Update progress
          await client
            .from('crawl_logs')
            .update({
              accounts_crawled: accountsProcessed,
              articles_found: totalFound,
              articles_new: totalNew,
              articles_matched: totalMatched,
            })
            .eq('id', logData.id)
          continue
        }

        // 3. Dedup by original_url
        const urls = matchedArticles.map(a => a.article.url).filter(Boolean)
        const existingUrls = new Set<string>()

        if (urls.length > 0) {
          const { data: existing } = await client
            .from('articles')
            .select('original_url')
            .in('original_url', urls)

          if (existing) {
            existing.forEach((e: any) => existingUrls.add(e.original_url))
          }
        }

        // 4. Filter duplicates and insert
        const newArticles = matchedArticles.filter(a => !existingUrls.has(a.article.url))
        totalDedupSkipped += matchedArticles.length - newArticles.length

        if (newArticles.length > 0) {
          const insertData = newArticles.map(a => ({
            account_id: account.id,
            title: a.article.title,
            original_title: a.article.title,
            original_url: a.article.url,
            summary: a.article.digest || null,
            content: a.article.content || null,
            published_at: a.article.publish_time
              ? new Date(a.article.publish_time * 1000).toISOString()
              : (a.article.published_at || new Date().toISOString()),
            unique_key: a.article.msg_id || null,
            matched_keywords: a.matchedKw.join(','),
            clean_status: 'pending',
          }))

          const { error: insertError } = await client
            .from('articles')
            .insert(insertData)

          if (insertError) {
            console.error(`[Cron Crawl] ${account.name} insert error:`, insertError.message)
            errors.push(`${account.name} insert: ${insertError.message}`)
          } else {
            totalNew += insertData.length
            console.log(`[Cron Crawl] ${account.name}: inserted ${insertData.length} new articles`)
          }
        }

        // 5. Update last_crawled_at
        await client
          .from('accounts')
          .update({ last_crawled_at: new Date().toISOString() })
          .eq('id', account.id)
        successAccountIds.push(account.id)

        // 6. Update progress in crawl log
        await client
          .from('crawl_logs')
          .update({
            accounts_crawled: accountsProcessed,
            articles_found: totalFound,
            articles_new: totalNew,
            articles_matched: totalMatched,
          })
          .eq('id', logData.id)

      } catch (accountError: any) {
        totalFailed++
        errors.push(`${account.name}: ${accountError.message}`)
        console.error(`[Cron Crawl] [${accountsProcessed}/${finalAccounts.length}] ${account.name} ERROR:`, accountError.message)

        try {
          await client
            .from('accounts')
            .update({ last_crawled_at: new Date().toISOString() })
            .eq('id', account.id)
        } catch {}
      }
    }

    // Finalize crawl log
    const { error: updateLogError } = await client
      .from('crawl_logs')
      .update({
        status: totalFailed > 0 || errors.length > 0 ? 'partial' : 'success',
        message: errors.length > 0 ? errors.slice(0, 20).join('; ') : null,
        accounts_crawled: accountsProcessed,
        articles_found: totalFound,
        articles_new: totalNew,
        articles_matched: totalMatched,
        finished_at: new Date().toISOString(),
      })
      .eq('id', logData.id)

    if (updateLogError) throw updateLogError

    // 记录本次自动抓取的公众号，用于周次数统计
    if (successAccountIds.length > 0) {
      await recordAccountCrawl(successAccountIds, client)
    }

    // 清理超过4天的历史文章
    const cutoffDate = new Date(cutoffTime).toISOString()
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
      accountsCrawled: accountsProcessed,
      accountsTotal: accounts.length,
      skippedByLimit: accounts.length - finalAccounts.length,
    })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
