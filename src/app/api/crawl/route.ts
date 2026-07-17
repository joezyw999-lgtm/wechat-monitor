import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { fetchAccountArticles, matchKeywords } from '@/lib/api-client'
import { requireAuth } from '@/lib/auth'
import { processArticleDedupFields } from '@/lib/recruit-dedup'
import { cleanArticlesWithLLM, type LLMCleanResult } from '@/lib/llm-clean'

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

    let totalFound = 0
    let totalSkippedOld = 0
    let totalNew = 0
    let totalMatched = 0
    let totalDedupSkipped = 0
    let totalFailed = 0
    const errors: string[] = []

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

      // Filter by publish time - only keep articles from the last 4 days
      const now = Date.now()
      const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000
      const cutoffTime = now - FOUR_DAYS_MS

      const recentArticles = result.articles.filter((article: any) => {
        const pubTime = article.published_at || article.publish_time
        if (!pubTime) return false
        const timestamp = new Date(pubTime).getTime()
        return !isNaN(timestamp) && timestamp >= cutoffTime
      })

      totalSkippedOld += result.articles.length - recentArticles.length

      for (const article of recentArticles) {
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
            published_at: a.article.publish_time
              ? new Date(a.article.publish_time * 1000).toISOString()
              : '',
          })),
          15,
        )
      : []

    // 合并 LLM 结果到每条文章，失败的降级为规则提取
    const enhancedArticles = allArticles.map((item, idx) => {
      const llm = llmResults[idx]
      if (llm) {
        return {
          ...item,
          llm,
          useLLM: true,
        }
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

    console.log(`[Crawl] Found ${existingUrls.size} existing URLs, ${existingStandardTitles.size} existing standard/normalized titles, ${existingDedupKeys.size} existing dedup keys`)

    // Filter out duplicates: by URL, by standard/normalized title, by dedup_key
    const newArticles = enhancedArticles.filter(a => {
      // URL 去重
      if (existingUrls.has(a.article.url)) return false
      // 标准标题 / 标准化标题去重
      const titleKey = a.useLLM ? a.llm?.standard_title : a.dedup.normalized_title
      if (titleKey && existingStandardTitles.has(titleKey)) return false
      // dedup_key / duplicate_key 去重（只有能提取到的时候才判重）
      const dedupKey = a.useLLM ? a.llm?.dedup_key : a.dedup.duplicate_key
      if (dedupKey && existingDedupKeys.has(dedupKey)) return false
      return true
    })

    totalDedupSkipped = allArticles.length - newArticles.length
    console.log(`[Crawl] ${newArticles.length} new articles to insert (after dedup), skipped ${totalDedupSkipped} by dedup`)

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
            published_at: new Date(a.article.publish_time * 1000).toISOString(),
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
          published_at: new Date(a.article.publish_time * 1000).toISOString(),
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
          console.error(`[Crawl] Batch insert error:`, insertError.message)
          errors.push(`Batch insert error: ${insertError.message}`)
        } else {
          totalNew += batch.length
          console.log(`[Crawl] Inserted batch of ${batch.length} articles`)
          // 把新插入的也加到去重集合里，避免同一批次内重复
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

    // Update crawl log - use correct field names
    const { error: updateLogError } = await client
      .from('crawl_logs')
      .update({
        status: totalFailed > 0 || errors.length > 0 ? 'partial' : 'success',
        finished_at: new Date().toISOString(),
        accounts_crawled: accounts.length,
        articles_found: totalFound,
        articles_new: totalNew,
        articles_matched: totalMatched,
        message: errors.length > 0 ? errors.join('; ') : null
      })
      .eq('id', logData.id)

    if (updateLogError) throw updateLogError

    // 清理超过4天的历史文章，确保数据库只保留近4天的数据
    const cutoffDate = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString()
    const { error: cleanupError } = await client
      .from('articles')
      .delete()
      .lt('published_at', cutoffDate)
    if (cleanupError) {
      console.error('[Crawl] Cleanup old articles error:', cleanupError.message)
    }

    return NextResponse.json({
      success: true,
      message: `采集完成: 发现 ${totalFound} 篇, 4天内 ${totalFound - totalSkippedOld} 篇, 命中 ${totalMatched} 篇, 去重跳过 ${totalDedupSkipped} 篇, 新增 ${totalNew} 篇`,
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
