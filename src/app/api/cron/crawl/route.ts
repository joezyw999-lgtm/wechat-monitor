import { NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { fetchAccountArticles, matchKeywords } from '@/lib/api-client'

// This route is called by Vercel Cron on a schedule
export async function GET() {
  try {
    const client = getSupabaseServiceClient() as any

    // Get API key from settings
    const { data: settingsData } = await client
      .from('settings')
      .select('key, value')
      .in('key', ['api_key', 'oneapi_key', 'article_count'])

    const settingsMap: Record<string, string> = {}
    settingsData?.forEach((s: any) => {
      settingsMap[s.key] = s.value
    })

    const apiKey = settingsMap['oneapi_key'] || settingsMap['api_key']
    if (!apiKey) {
      return NextResponse.json({ success: false, message: 'API Key not configured' }, { status: 400 })
    }

    const articleCount = parseInt(settingsMap['article_count'] || '20', 10)

    // Get active accounts
    const { data: accounts } = await client
      .from('accounts')
      .select('*')
      .eq('status', 'active')

    if (!accounts || accounts.length === 0) {
      return NextResponse.json({ success: true, message: 'No active accounts' })
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
      .insert({ status: 'running', message: 'Cron job started' })
      .select()
      .single()

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
        published_at: a.article.published_at || new Date().toISOString(),
        unique_key: a.article.msg_id || null,
        matched_keywords: a.matchedKw.join(',')
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

    const { error: updateLogError } = await client
      .from('crawl_logs')
      .update({
        status: totalFailed > 0 || errors.length > 0 ? 'partial' : 'success',
        message: errors.length > 0 ? errors.join('; ') : null,
        accounts_crawled: accounts.length,
        articles_found: totalFound,
        articles_new: totalNew,
        articles_matched: totalMatched,
        finished_at: new Date().toISOString(),
      })
      .eq('id', logData.id)

    if (updateLogError) throw updateLogError

    return NextResponse.json({ success: true, totalFound, totalNew, totalMatched, totalFailed })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
