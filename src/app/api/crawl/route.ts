import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { fetchAccountArticles, matchKeywords } from '@/lib/api-client'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const accountId = body.accountId // optional, if not provided, crawl all
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

    // Get active keywords
    const { data: keywordsData, error: kwError } = await client
      .from('keywords')
      .select('word')
      .eq('status', 'active')
    if (kwError) throw kwError
    const keywords = keywordsData?.map((k: any) => k.word) || []

    // Create crawl log
    const { data: logData, error: logError } = await client
      .from('crawl_logs')
      .insert({
        status: 'running',
        started_at: new Date().toISOString()
      })
      .select()
      .single()
    if (logError) throw logError

    let totalFound = 0
    let totalNew = 0
    let totalMatched = 0
    let totalFailed = 0
    const errors: string[] = []

    // Collect all articles from all accounts first
    const allArticles: Array<{
      account: any
      article: any
      matchedKw: string[]
    }> = []

    // Crawl each account and collect articles
    for (const account of accounts) {
      const result = await fetchAccountArticles(apiKey, account.wx_id, articleCount)
      
      if (!result.success) {
        totalFailed++
        errors.push(`${account.name}: ${result.error}`)
        continue
      }

      // Log how many articles were returned from API
      console.log(`[Crawl] Account ${account.name} (${account.wx_id}): API returned ${result.articles.length} articles`)
      totalFound += result.articles.length

      for (const article of result.articles) {
        // Match keywords first - only save articles that match at least one keyword
        const matchedKw = matchKeywords(article.title, article.digest || '', keywords)
        
        if (matchedKw.length === 0) {
          console.log(`[Crawl] Skipping (no keyword match): ${article.title}`)
          continue
        }

        allArticles.push({ account, article, matchedKw })
      }
    }

    // Batch deduplication: get all existing URLs from database in one query
    const allUrls = allArticles.map(a => a.article.url).filter(Boolean)
    let existingUrls = new Set<string>()

    if (allUrls.length > 0) {
      // Query in batches of 100 to avoid URL length limits
      const batchSize = 100
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

    console.log(`[Crawl] Found ${existingUrls.size} existing URLs in database`)

    // Filter out duplicates and prepare for batch insert
    const newArticles = allArticles.filter(a => !existingUrls.has(a.article.url))
    console.log(`[Crawl] ${newArticles.length} new articles to insert (after dedup)`)

    // Batch insert new articles
    if (newArticles.length > 0) {
      const insertData = newArticles.map(a => ({
        account_id: a.account.id,
        title: a.article.title,
        original_url: a.article.url,
        summary: a.article.digest || null,
        content: a.article.content || null,
        published_at: new Date(a.article.publish_time * 1000).toISOString(),
        unique_key: a.article.msg_id || null,
        matched_keywords: a.matchedKw
      }))

      // Insert in batches of 50
      const insertBatchSize = 50
      for (let i = 0; i < insertData.length; i += insertBatchSize) {
        const batch = insertData.slice(i, i + insertBatchSize)
        const { error: insertError } = await client
          .from('articles')
          .insert(batch)

        if (insertError) {
          console.error(`[Crawl] Batch insert error:`, insertError.message)
          errors.push(`Batch insert error: ${insertError.message}`)
        } else {
          totalNew += batch.length
          console.log(`[Crawl] Inserted batch of ${batch.length} articles`)
        }
      }

      totalMatched = newArticles.length
    }

    // Update crawl log - use correct field names
    await client
      .from('crawl_logs')
      .update({
        status: totalFailed > 0 ? 'partial' : 'success',
        finished_at: new Date().toISOString(),
        accounts_crawled: accounts.length,
        articles_found: totalFound,
        articles_new: totalNew,
        articles_matched: totalMatched,
        message: errors.length > 0 ? errors.join('; ') : null
      })
      .eq('id', logData.id)

    return NextResponse.json({
      success: true,
      message: `采集完成: 发现 ${totalFound} 篇, 新增 ${totalNew} 篇, 命中关键词 ${totalMatched} 篇`,
      data: {
        accounts_crawled: accounts.length,
        articles_found: totalFound,
        articles_new: totalNew,
        articles_matched: totalMatched,
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
