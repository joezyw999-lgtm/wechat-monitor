import { NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { fetchAccountArticles, matchKeywords } from '@/lib/api-client'
import { processArticleDedupFields } from '@/lib/recruit-dedup'
import { cleanArticlesWithLLM, type LLMCleanResult } from '@/lib/llm-clean'
import { filterAccountsByCrawlLimit, recordAccountCrawl } from '@/lib/crawl-limit'

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

    // 全局频率限制：过滤掉今天不能自动抓取的公众号
    const { allowedAccounts, skipReason } = await filterAccountsByCrawlLimit(accounts, client)

    if (allowedAccounts.length === 0) {
      const reason = skipReason.weekend
        ? '今天是周末，跳过自动抓取'
        : skipReason.holiday
        ? '今天是法定节假日，跳过自动抓取'
        : skipReason.weeklyLimit > 0
        ? `全部公众号本周已达5次抓取上限（${skipReason.weeklyLimit}个公众号被限制）`
        : '无可抓取的公众号'

      // 写一条跳过日志
      await client.from('crawl_logs').insert({
        status: 'skipped',
        message: reason,
        accounts_crawled: 0,
        articles_found: 0,
        articles_new: 0,
        articles_matched: 0,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        keywords_used: null,
      })

      return NextResponse.json({ success: true, skipped: true, message: reason })
    }

    const finalAccounts: any[] = allowedAccounts

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
    for (const account of finalAccounts) {
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

    // LLM 批量清洗标题 + 生成去重字段（只对关键词命中的文章调用）
    const llmResults: (LLMCleanResult | null)[] = allArticles.length > 0
      ? await cleanArticlesWithLLM(
          allArticles.map(a => ({
            title: a.article.title,
            summary: a.article.digest || '',
            original_url: a.article.url,
            published_at: a.article.published_at || '',
          })),
          15,
        )
      : []

    // 合并 LLM 结果到每条文章，失败的降级为规则提取
    const enhancedArticles = allArticles.map((item, idx) => {
      const llm = llmResults[idx]
      if (llm) {
        return { ...item, llm, useLLM: true }
      }
      return { ...item, llm: null, useLLM: false }
    })

    // Batch deduplication: check original_url, dedup_key, standard_title / normalized_title in bulk
    const allUrls = enhancedArticles.map(a => a.article.url).filter(Boolean)
    const allDedupKeys = enhancedArticles
      .map(a => (a.useLLM ? a.llm?.dedup_key : a.dedup.duplicate_key) || '')
      .filter(Boolean)
    const allStandardTitles = enhancedArticles
      .map(a => (a.useLLM ? a.llm?.standard_title : a.dedup.normalized_title) || '')
      .filter(Boolean)

    let existingUrls = new Set<string>()
    let existingDedupKeys = new Set<string>()
    let existingStandardTitles = new Set<string>()

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

    // 批量查已存在的 dedup_key
    if (allDedupKeys.length > 0) {
      for (let i = 0; i < allDedupKeys.length; i += batchSize) {
        const batch = allDedupKeys.slice(i, i + batchSize)
        const { data: existing } = await client
          .from('articles')
          .select('dedup_key')
          .in('dedup_key', batch)

        if (existing) {
          existing.forEach((e: any) => existingDedupKeys.add(e.dedup_key))
        }
      }
    }

    // 批量查已存在的 standard_title（同时兼容 normalized_title）
    if (allStandardTitles.length > 0) {
      for (let i = 0; i < allStandardTitles.length; i += batchSize) {
        const batch = allStandardTitles.slice(i, i + batchSize)
        const { data: existing } = await client
          .from('articles')
          .select('standard_title,normalized_title')
          .or(`standard_title.in.(${batch.join(',')}),normalized_title.in.(${batch.join(',')})`)

        if (existing) {
          existing.forEach((e: any) => {
            if (e.standard_title) existingStandardTitles.add(e.standard_title)
            if (e.normalized_title) existingStandardTitles.add(e.normalized_title)
          })
        }
      }
    }

    console.log(`[Cron Crawl] Found ${existingUrls.size} existing URLs, ${existingStandardTitles.size} existing standard/normalized titles, ${existingDedupKeys.size} existing dedup keys`)

    // Filter out duplicates: by URL, by standard/normalized title, by dedup_key
    const newArticles = enhancedArticles.filter(a => {
      if (existingUrls.has(a.article.url)) return false
      const titleKey = a.useLLM ? a.llm?.standard_title : a.dedup.normalized_title
      if (titleKey && existingStandardTitles.has(titleKey)) return false
      const dedupKey = a.useLLM ? a.llm?.dedup_key : a.dedup.duplicate_key
      if (dedupKey && existingDedupKeys.has(dedupKey)) return false
      return true
    })

    totalDedupSkipped = allArticles.length - newArticles.length
    console.log(`[Cron Crawl] ${newArticles.length} new articles to insert (after dedup), skipped ${totalDedupSkipped} by dedup`)

    // Batch insert new articles
    if (newArticles.length > 0) {
      const insertData = newArticles.map(a => {
        if (a.useLLM && a.llm) {
          const llm = a.llm
          return {
            account_id: a.account.id,
            title: llm.standard_title || a.article.title,
            original_title: a.article.title,
            standard_title: llm.standard_title || null,
            normalized_title: null,
            original_url: a.article.url,
            summary: a.article.digest || null,
            content: a.article.content || null,
            published_at: a.article.published_at || new Date().toISOString(),
            unique_key: a.article.msg_id || null,
            matched_keywords: a.matchedKw.join(','),
            company_name: llm.company_name || null,
            recruit_type: llm.recruit_type || null,
            recruit_batch: llm.recruit_batch || null,
            dedup_key: llm.dedup_key || null,
            duplicate_key: null,
          }
        }
        const dedup = a.dedup
        return {
          account_id: a.account.id,
          title: dedup.normalized_title || a.article.title,
          original_title: a.article.title,
          standard_title: null,
          normalized_title: dedup.normalized_title,
          original_url: a.article.url,
          summary: a.article.digest || null,
          content: a.article.content || null,
          published_at: a.article.published_at || new Date().toISOString(),
          unique_key: a.article.msg_id || null,
          matched_keywords: a.matchedKw.join(','),
          company_name: dedup.company_name || null,
          recruit_type: dedup.recruit_type || null,
          recruit_batch: dedup.recruit_batch || null,
          dedup_key: null,
          duplicate_key: dedup.duplicate_key || null,
        }
      })

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
            if (item.standard_title) existingStandardTitles.add(item.standard_title)
            if (item.normalized_title) existingStandardTitles.add(item.normalized_title)
            if (item.dedup_key) existingDedupKeys.add(item.dedup_key)
            if (item.duplicate_key) existingDedupKeys.add(item.duplicate_key)
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
