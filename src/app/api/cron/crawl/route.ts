import { NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { fetchAccountArticles, matchKeywords } from '@/lib/api-client'
import { processArticleDedupFields } from '@/lib/recruit-dedup'

// This route is called by Vercel Cron on a schedule
export async function GET(request: Request) {
  // Verify CRON_SECRET header
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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

    // Collect all articles from all accounts first
    const allArticles: Array<{
      account: any
      article: any
      matchedKw: string[]
      dedup: {
        original_title: string
        normalized_title: string
        company_name: string
        recruit_type: string
        recruit_batch: string
        duplicate_key: string | null
      }
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
        // Skip articles without publish time
        if (!article.published_at) {
          console.log(`[Crawl] Skipping (no publish time): ${article.title}`)
          continue
        }

        // Skip articles older than 4 days
        const pubTime = new Date(article.published_at).getTime()
        if (isNaN(pubTime) || pubTime < cutoffTime) {
          console.log(`[Crawl] Skipping (too old): ${article.title}`)
          totalSkippedOld++
          continue
        }

        // Match keywords first - only save articles that match at least one keyword
        const matchedKw = matchKeywords(article.title, article.digest || '', keywords)
        
        if (matchedKw.length === 0) {
          console.log(`[Crawl] Skipping (no keyword match): ${article.title}`)
          continue
        }

        // 生成去重相关字段
        const dedup = processArticleDedupFields({
          title: article.title,
          digest: article.digest,
        })

        allArticles.push({ account, article, matchedKw, dedup })
      }
    }

    // Batch deduplication: check original_url, normalized_title, duplicate_key in bulk
    const allUrls = allArticles.map(a => a.article.url).filter(Boolean)
    const allNormalizedTitles = allArticles.map(a => a.dedup.normalized_title).filter(Boolean)
    const allDuplicateKeys = allArticles
      .map(a => a.dedup.duplicate_key)
      .filter((k): k is string => !!k)

    let existingUrls = new Set<string>()
    let existingNormalizedTitles = new Set<string>()
    let existingDuplicateKeys = new Set<string>()

    const batchSize = 100

    // 批量查已存在的 original_url
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

    // 批量查已存在的 normalized_title
    if (allNormalizedTitles.length > 0) {
      for (let i = 0; i < allNormalizedTitles.length; i += batchSize) {
        const batch = allNormalizedTitles.slice(i, i + batchSize)
        const { data: existing } = await client
          .from('articles')
          .select('normalized_title')
          .in('normalized_title', batch)

        if (existing) {
          existing.forEach((e: any) => existingNormalizedTitles.add(e.normalized_title))
        }
      }
    }

    // 批量查已存在的 duplicate_key
    if (allDuplicateKeys.length > 0) {
      for (let i = 0; i < allDuplicateKeys.length; i += batchSize) {
        const batch = allDuplicateKeys.slice(i, i + batchSize)
        const { data: existing } = await client
          .from('articles')
          .select('duplicate_key')
          .in('duplicate_key', batch)

        if (existing) {
          existing.forEach((e: any) => existingDuplicateKeys.add(e.duplicate_key))
        }
      }
    }

    console.log(`[Cron Crawl] Found ${existingUrls.size} existing URLs, ${existingNormalizedTitles.size} existing normalized titles, ${existingDuplicateKeys.size} existing duplicate keys`)

    // Filter out duplicates: by URL, by normalized title, by duplicate_key
    const newArticles = allArticles.filter(a => {
      if (existingUrls.has(a.article.url)) return false
      if (a.dedup.normalized_title && existingNormalizedTitles.has(a.dedup.normalized_title)) return false
      if (a.dedup.duplicate_key && existingDuplicateKeys.has(a.dedup.duplicate_key)) return false
      return true
    })

    totalDedupSkipped = allArticles.length - newArticles.length
    console.log(`[Cron Crawl] ${newArticles.length} new articles to insert (after dedup), skipped ${totalDedupSkipped} by dedup`)

    // Batch insert new articles
    if (newArticles.length > 0) {
      const insertData = newArticles.map(a => ({
        account_id: a.account.id,
        title: a.dedup.normalized_title || a.article.title,
        original_title: a.article.title,
        normalized_title: a.dedup.normalized_title,
        original_url: a.article.url,
        summary: a.article.digest || null,
        content: a.article.content || null,
        published_at: a.article.published_at || new Date().toISOString(),
        unique_key: a.article.msg_id || null,
        matched_keywords: a.matchedKw.join(','),
        company_name: a.dedup.company_name || null,
        recruit_type: a.dedup.recruit_type || null,
        recruit_batch: a.dedup.recruit_batch || null,
        duplicate_key: a.dedup.duplicate_key || null,
      }))

      // Insert in batches of 50
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
            if (item.normalized_title) existingNormalizedTitles.add(item.normalized_title)
            if (item.duplicate_key) existingDuplicateKeys.add(item.duplicate_key)
            if (item.original_url) existingUrls.add(item.original_url)
          })
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
        articles_found: totalMatched,
        articles_new: totalNew,
        articles_matched: totalMatched,
        finished_at: new Date().toISOString(),
      })
      .eq('id', logData.id)

    if (updateLogError) throw updateLogError

    // 清理超过4天的历史文章
    const cutoffDate = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString()
    const { error: cleanupError } = await client
      .from('articles')
      .delete()
      .lt('published_at', cutoffDate)
    if (cleanupError) {
      console.error('[Cron Crawl] Cleanup old articles error:', cleanupError.message)
    }

    return NextResponse.json({ success: true, totalFound, totalNew, totalMatched, totalFailed })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
