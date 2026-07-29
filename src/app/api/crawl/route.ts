import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { fetchAccountArticles, matchKeywords } from '@/lib/api-client'
import { requireAuth } from '@/lib/auth'

export const runtime = 'nodejs'
export const maxDuration = 300 // 5 minutes for large account lists

export async function POST(request: NextRequest) {
  const session = await requireAuth(request)
  if (session instanceof Response) return session

  try {
    const body = await request.json()
    const accountId = body.accountId // optional, if not provided, crawl all
    const keywordFilter: string[] | undefined = body.keywords && Array.isArray(body.keywords) && body.keywords.length > 0 ? body.keywords : undefined
    const client = getSupabaseServiceClient() as any

    // Get API key and article count from settings (bypass cache for fresh data)
    const { data: settingsData, error: settingsError } = await client
      .from('settings')
      .select('key, value')
      .in('key', ['api_key', 'oneapi_key', 'article_count'])
    if (settingsError) throw settingsError

    const settingsMap = new Map<string, string>(settingsData?.map((s: any) => [s.key, s.value]) || [])
    const apiKey = settingsMap.get('oneapi_key') || settingsMap.get('api_key')
    const articleCount = parseInt(settingsMap.get('article_count') ?? '20', 10)

    if (!apiKey) {
      return NextResponse.json({ success: false, message: '请先在系统设置中配置 OneAPI Key' }, { status: 400 })
    }

    // Get accounts to crawl
    let accountsQuery = client.from('accounts').select('*').eq('status', 'active')
    if (accountId) {
      accountsQuery = client.from('accounts').select('*').eq('id', accountId)
    }
    const { data: accounts, error: accError } = await accountsQuery
    if (accError) throw accError

    if (!accounts || accounts.length === 0) {
      return NextResponse.json({ success: false, message: '没有可采集的公众号' }, { status: 400 })
    }

    console.log(`[Crawl] Starting crawl for ${accounts.length} active accounts`)

    // Get active keywords (optionally filtered by user selection)
    let keywordsQuery = client
      .from('keywords')
      .select('word')
      .eq('status', 'active')
    if (keywordFilter) {
      keywordsQuery = keywordsQuery.in('word', keywordFilter)
    }
    const { data: keywordsData, error: kwError } = await keywordsQuery
    if (kwError) throw kwError
    const keywords = keywordsData?.map((k: any) => k.word) || []

    // Create crawl log
    const { data: logData, error: logError } = await client
      .from('crawl_logs')
      .insert({
        status: 'running',
        started_at: new Date().toISOString(),
        keywords_used: keywordFilter ? keywordFilter.join(',') : null
      })
      .select()
      .single()
    if (logError) throw logError

    // Counters
    let totalFound = 0
    let totalSkippedOld = 0
    let totalNew = 0
    let totalMatched = 0
    let totalDedupSkipped = 0
    let totalFailed = 0
    let accountsProcessed = 0
    const errors: string[] = []

    // 4-day cutoff
    const now = Date.now()
    const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000
    const cutoffTime = now - FOUR_DAYS_MS

    // Process each account individually: fetch -> filter -> dedup -> insert
    for (const account of accounts) {
      accountsProcessed++
      
      try {
        // 1. Fetch articles from API
        const result = await fetchAccountArticles(apiKey, account.wx_id, articleCount)
        
        if (!result.success) {
          totalFailed++
          errors.push(`${account.name}: ${result.error}`)
          console.log(`[Crawl] [${accountsProcessed}/${accounts.length}] ${account.name} FAILED: ${result.error}`)
          // Still update last_crawled_at even on failure
          await client
            .from('accounts')
            .update({ last_crawled_at: new Date().toISOString() })
            .eq('id', account.id)
          continue
        }

        console.log(`[Crawl] [${accountsProcessed}/${accounts.length}] ${account.name}: API returned ${result.articles.length} articles`)
        totalFound += result.articles.length

        // 2. Filter by publish time - only keep articles from the last 4 days
        const recentArticles = result.articles.filter((article: any) => {
          const pubTime = article.published_at || article.publish_time
          if (!pubTime) return false
          const timestamp = typeof pubTime === 'number' ? pubTime * 1000 : new Date(pubTime).getTime()
          return !isNaN(timestamp) && timestamp >= cutoffTime
        })

        totalSkippedOld += result.articles.length - recentArticles.length

        // 3. Match keywords
        const matchedArticles: Array<{ article: any; matchedKw: string[] }> = []
        for (const article of recentArticles) {
          const matchedKw = matchKeywords(article.title, article.digest || '', keywords)
          if (matchedKw.length === 0) {
            continue
          }
          matchedArticles.push({ article, matchedKw })
        }

        totalMatched += matchedArticles.length

        if (matchedArticles.length === 0) {
          // No matching articles, just update last_crawled_at
          await client
            .from('accounts')
            .update({ last_crawled_at: new Date().toISOString() })
            .eq('id', account.id)
          
          // Update progress in crawl log
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

        // 4. Dedup by original_url for this account's articles
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

        // 5. Filter out duplicates and prepare insert data
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

          // Insert articles
          const { error: insertError } = await client
            .from('articles')
            .insert(insertData)

          if (insertError) {
            console.error(`[Crawl] ${account.name} insert error:`, insertError.message)
            errors.push(`${account.name} insert: ${insertError.message}`)
          } else {
            totalNew += insertData.length
            console.log(`[Crawl] ${account.name}: inserted ${insertData.length} new articles`)
          }
        }

        // 6. Update last_crawled_at for this account
        await client
          .from('accounts')
          .update({ last_crawled_at: new Date().toISOString() })
          .eq('id', account.id)

        // 7. Update progress in crawl log
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
        // If any error occurs processing this account, log it and continue
        totalFailed++
        errors.push(`${account.name}: ${accountError.message}`)
        console.error(`[Crawl] [${accountsProcessed}/${accounts.length}] ${account.name} ERROR:`, accountError.message)
        
        // Still try to update last_crawled_at
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
        finished_at: new Date().toISOString(),
        accounts_crawled: accountsProcessed,
        articles_found: totalFound,
        articles_new: totalNew,
        articles_matched: totalMatched,
        message: errors.length > 0 ? errors.slice(0, 20).join('; ') : null // Limit error messages
      })
      .eq('id', logData.id)

    if (updateLogError) throw updateLogError

    // Cleanup old articles (older than 4 days)
    const cutoffDate = new Date(cutoffTime).toISOString()
    const { error: cleanupError } = await client
      .from('articles')
      .delete()
      .lt('published_at', cutoffDate)
    if (cleanupError) {
      console.error('[Crawl] Cleanup old articles error:', cleanupError.message)
    }

    return NextResponse.json({
      success: true,
      message: `采集完成: ${accountsProcessed}个账号, 发现${totalFound}篇, 命中${totalMatched}篇, 去重跳过${totalDedupSkipped}篇, 新增${totalNew}篇, 失败${totalFailed}个`,
      data: {
        accounts_crawled: accountsProcessed,
        accounts_failed: totalFailed,
        articles_found: totalFound,
        articles_new: totalNew,
        articles_matched: totalMatched,
        articles_dedup_skipped: totalDedupSkipped,
        errors
      }
    })
  } catch (error: any) {
    console.error('Crawl error:', error)
    return NextResponse.json({ 
      success: false, 
      message: error.message || '采集失败' 
    }, { status: 500 })
  }
}
