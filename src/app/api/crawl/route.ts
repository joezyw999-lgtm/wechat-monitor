import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { fetchAccountArticles, matchKeywords } from '@/lib/api-client'
import { requireAuth } from '@/lib/auth'
import { normalizeTitleForDedup, dedupArticlesByTitle } from '@/lib/title-normalize'

export const runtime = 'nodejs'
export const maxDuration = 300

// 安全时间上限（毫秒）：Vercel 限制 300s，留 40s 余量
const SAFE_TIME_LIMIT_MS = 260 * 1000
// 超时日志清理阈值（分钟）
const STALE_LOG_MINUTES = 10

/**
 * 清理超时的运行中日志（超过 STALE_LOG_MINUTES 分钟仍为 running）
 */
async function cleanupStaleLogs(client: any) {
  const staleThreshold = new Date(Date.now() - STALE_LOG_MINUTES * 60 * 1000).toISOString()
  const { data: staleLogs } = await client
    .from('crawl_logs')
    .select('id, started_at, cursor_position, total_accounts, accounts_crawled, articles_new')
    .eq('status', 'running')
    .lt('started_at', staleThreshold)

  if (staleLogs && staleLogs.length > 0) {
    for (const log of staleLogs) {
      const cursor = log.cursor_position || 0
      const total = log.total_accounts || 0
      const crawled = log.accounts_crawled || 0
      await client
        .from('crawl_logs')
        .update({
          status: 'timeout',
          finished_at: new Date().toISOString(),
          message: `采集超时自动标记（已处理 ${crawled}/${total} 个账号，游标位置 ${cursor}）`,
        })
        .eq('id', log.id)
    }
    console.log(`[Crawl] Cleaned up ${staleLogs.length} stale running logs`)
  }
}

/**
 * 查找可恢复的采集任务（status='partial' 且 cursor_position < total_accounts）
 */
async function findResumableLog(client: any) {
  const { data } = await client
    .from('crawl_logs')
    .select('*')
    .eq('status', 'partial')
    .gt('total_accounts', 0)
    .order('started_at', { ascending: false })
    .limit(1)

  if (data && data.length > 0) {
    const log = data[0]
    if ((log.cursor_position || 0) < (log.total_accounts || 0)) {
      return log
    }
  }
  return null
}

/**
 * 处理单个公众号：抓取 → 过滤 → 去重 → 入库
 * 返回 { found, matched, newCount, dedupSkipped, oldSkipped, error? }
 */
async function processOneAccount(
  client: any,
  account: any,
  apiKey: string,
  articleCount: number,
  keywords: string[],
  cutoffTime: number,
) {
  const result = await fetchAccountArticles(apiKey, account.wx_id, articleCount)

  if (!result.success) {
    return { found: 0, matched: 0, newCount: 0, dedupSkipped: 0, oldSkipped: 0, error: result.error }
  }

  const found = result.articles.length

  // 过滤近4天
  const recentArticles = result.articles.filter((article: any) => {
    const pubTime = article.published_at || article.publish_time
    if (!pubTime) return false
    const timestamp = typeof pubTime === 'number' ? pubTime * 1000 : new Date(pubTime).getTime()
    return !isNaN(timestamp) && timestamp >= cutoffTime
  })
  const oldSkipped = found - recentArticles.length

  // 关键词匹配
  const matchedArticles: Array<{ article: any; matchedKw: string[] }> = []
  for (const article of recentArticles) {
    const matchedKw = matchKeywords(article.title, article.digest || '', keywords)
    if (matchedKw.length > 0) {
      matchedArticles.push({ article, matchedKw })
    }
  }
  const matched = matchedArticles.length

  if (matched === 0) {
    return { found, matched: 0, newCount: 0, dedupSkipped: 0, oldSkipped }
  }

  // URL去重
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

  let filteredByUrl = matchedArticles.filter(a => !existingUrls.has(a.article.url))
  const urlDedupSkipped = matched - filteredByUrl.length

  // 标题完全一致去重（第一层：同批次内去重）
  const titleDedupResult = dedupArticlesByTitle(
    filteredByUrl.map(a => ({
      title: a.article.title,
      published_at: a.article.publish_time
        ? new Date(a.article.publish_time * 1000).toISOString()
        : a.article.published_at,
      original: a,
    })),
  )
  const dedupedWithinBatch = titleDedupResult.map(a => (a as any).original)
  const titleDedupBatchSkipped = filteredByUrl.length - dedupedWithinBatch.length

  // 标题完全一致去重（第二层：与数据库已有标题去重）
  const titles = dedupedWithinBatch
    .map(a => normalizeTitleForDedup(a.article.title))
    .filter(Boolean)
  let titleDedupDbSkipped = 0
  let newArticles: typeof matchedArticles = dedupedWithinBatch

  if (titles.length > 0) {
    const { data: existingTitles } = await client
      .from('articles')
      .select('title, normalized_title')
      .in('normalized_title', titles)
    
    const existingNormalizedTitles = new Set<string>()
    if (existingTitles) {
      existingTitles.forEach((e: any) => {
        if (e.normalized_title) {
          existingNormalizedTitles.add(e.normalized_title)
        }
      })
    }

    newArticles = dedupedWithinBatch.filter(a => {
      const normalized = normalizeTitleForDedup(a.article.title)
      if (!normalized) return true
      return !existingNormalizedTitles.has(normalized)
    })
    titleDedupDbSkipped = dedupedWithinBatch.length - newArticles.length
  }

  const dedupSkipped = urlDedupSkipped + titleDedupBatchSkipped + titleDedupDbSkipped

  // 入库
  let newCount = 0
  if (newArticles.length > 0) {
    const insertData = newArticles.map(a => ({
      account_id: account.id,
      title: a.article.title,
      original_title: a.article.title,
      normalized_title: normalizeTitleForDedup(a.article.title),
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

    const { error: insertError } = await client.from('articles').insert(insertData)
    if (insertError) {
      console.error(`[Crawl] ${account.name} insert error:`, insertError.message)
      return { found, matched, newCount: 0, dedupSkipped, oldSkipped, error: insertError.message }
    }
    newCount = insertData.length
  }

  return { found, matched, newCount, dedupSkipped, oldSkipped }
}

/**
 * 检查是否有正在运行的采集任务
 */
async function hasRunningCrawl(client: any): Promise<boolean> {
  const { data } = await client
    .from('crawl_logs')
    .select('id')
    .eq('status', 'running')
    .limit(1)
  
  return data && data.length > 0
}

export async function GET(request: NextRequest) {
  const session = await requireAuth(request)
  if (session instanceof Response) return session

  const client = getSupabaseServiceClient() as any
  
  // 获取最新的采集日志
  const { data: logs } = await client
    .from('crawl_logs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(5)

  if (!logs || logs.length === 0) {
    return NextResponse.json({ success: true, data: { logs: [], current: null, has_running: false } })
  }

  const current = logs[0]
  const hasMore = 
    current.status === 'partial' && 
    current.total_accounts > 0 && 
    (current.cursor_position || 0) < (current.total_accounts || 0)

  return NextResponse.json({
    success: true,
    data: {
      logs,
      current,
      has_running: current.status === 'running',
      has_more: hasMore,
    }
  })
}

export async function POST(request: NextRequest) {
  const session = await requireAuth(request)
  if (session instanceof Response) return session

  try {
    const body = await request.json()
    const accountId = body.accountId
    const keywordFilter: string[] | undefined = body.keywords && Array.isArray(body.keywords) && body.keywords.length > 0 ? body.keywords : undefined
    const resume = body.resume === true // 是否强制恢复上次任务
    const client = getSupabaseServiceClient() as any

    // Step 0: 清理超时日志
    await cleanupStaleLogs(client)

    // Step 0.5: 任务锁 - 批量采集时检查是否已有运行中的任务
    if (!accountId) {
      const running = await hasRunningCrawl(client)
      if (running) {
        // 如果有正在运行的任务，返回冲突提示，但带上当前进度
        const { data: currentLog } = await client
          .from('crawl_logs')
          .select('*')
          .eq('status', 'running')
          .order('started_at', { ascending: false })
          .limit(1)
          .single()
        
        return NextResponse.json({
          success: false,
          message: '已有采集任务正在运行中，请等待当前任务完成',
          data: { 
            concurrent: true,
            current: currentLog,
          }
        }, { status: 409 })
      }
    }

    // Get API key and article count from settings
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

    // Step 1: 检查是否有可恢复的任务
    let resumableLog: any = null
    if (resume || !accountId) {
      resumableLog = await findResumableLog(client)
    }

    // Get keywords
    let keywordsQuery = client.from('keywords').select('word').eq('status', 'active')
    if (keywordFilter) {
      keywordsQuery = keywordsQuery.in('word', keywordFilter)
    }
    const { data: keywordsData } = await keywordsQuery
    const keywords = keywordsData?.map((k: any) => k.word) || []

    const cutoffTime = Date.now() - 4 * 24 * 60 * 60 * 1000
    const startTime = Date.now()

    // 如果是恢复任务，从上次位置继续
    if (resumableLog && !accountId) {
      console.log(`[Crawl] Resuming from log ${resumableLog.id}, cursor=${resumableLog.cursor_position}, total=${resumableLog.total_accounts}`)

      // 获取公众号列表
      const { data: allAccounts } = await client
        .from('accounts')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: true })

      if (!allAccounts || allAccounts.length === 0) {
        return NextResponse.json({ success: false, message: '没有可采集的公众号' }, { status: 400 })
      }

      // 从 cursor 位置开始
      const cursorPos = resumableLog.cursor_position || 0
      const remainingAccounts = allAccounts.slice(cursorPos)

      if (remainingAccounts.length === 0) {
        // 已全部完成
        await client.from('crawl_logs').update({
          status: 'success',
          finished_at: new Date().toISOString(),
          message: '恢复采集：所有公众号已完成',
        }).eq('id', resumableLog.id)

        return NextResponse.json({
          success: true,
          message: '所有公众号已采集完成',
          data: { resumed: true, log_id: resumableLog.id, remaining: 0 }
        })
      }

      // 更新日志状态为 running
      await client.from('crawl_logs').update({
        status: 'running',
        message: `恢复采集，从第 ${cursorPos + 1} 个账号开始（共 ${remainingAccounts.length} 个待处理）`,
      }).eq('id', resumableLog.id)

      // 执行采集
      const result = await crawlAccounts(
        client, remainingAccounts, apiKey, articleCount, keywords, cutoffTime,
        resumableLog.id, cursorPos, allAccounts.length,
        resumableLog.articles_found || 0,
        resumableLog.articles_new || 0,
        resumableLog.articles_matched || 0,
        startTime
      )

      return NextResponse.json({
        success: true,
        message: result.message,
        data: { 
          ...result, 
          resumed: true, 
          log_id: resumableLog.id,
          has_more: !result.all_done,
        }
      })
    }

    // 全新采集
    let accountsQuery = client.from('accounts').select('*').eq('status', 'active')
    if (accountId) {
      accountsQuery = client.from('accounts').select('*').eq('id', accountId)
    }
    const { data: accounts, error: accError } = await accountsQuery
    if (accError) throw accError

    if (!accounts || accounts.length === 0) {
      return NextResponse.json({ success: false, message: '没有可采集的公众号' }, { status: 400 })
    }

    console.log(`[Crawl] Starting fresh crawl for ${accounts.length} active accounts`)

    // 创建新日志
    const { data: logData, error: logError } = await client
      .from('crawl_logs')
      .insert({
        status: 'running',
        started_at: new Date().toISOString(),
        keywords_used: keywordFilter ? keywordFilter.join(',') : null,
        total_accounts: accounts.length,
        cursor_position: 0,
        account_ids: accounts.map((a: any) => a.id).join(','),
      })
      .select()
      .single()
    if (logError) throw logError

    const result = await crawlAccounts(
      client, accounts, apiKey, articleCount, keywords, cutoffTime,
      logData.id, 0, accounts.length,
      0, 0, 0, startTime
    )

    return NextResponse.json({
      success: true,
      message: result.message,
      data: { 
        ...result, 
        resumed: false, 
        log_id: logData.id,
        has_more: !result.all_done,
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

/**
 * 核心采集逻辑：逐个处理公众号，带时间感知
 */
async function crawlAccounts(
  client: any,
  accounts: any[],
  apiKey: string,
  articleCount: number,
  keywords: string[],
  cutoffTime: number,
  logId: string,
  startCursor: number,
  totalAccounts: number,
  initFound: number,
  initNew: number,
  initMatched: number,
  startTime: number,
) {
  let totalFound = initFound
  let totalNew = initNew
  let totalMatched = initMatched
  let totalFailed = 0
  let accountsProcessed = 0
  const errors: string[] = []
  let cursor = startCursor
  let timedOut = false

  for (const account of accounts) {
    // 时间感知：检查是否接近超时
    const elapsed = Date.now() - startTime
    if (elapsed >= SAFE_TIME_LIMIT_MS) {
      console.log(`[Crawl] Approaching time limit (${Math.round(elapsed / 1000)}s), stopping at cursor=${cursor}`)
      timedOut = true
      break
    }

    accountsProcessed++
    cursor++

    try {
      const { found, matched, newCount, dedupSkipped, oldSkipped, error } =
        await processOneAccount(client, account, apiKey, articleCount, keywords, cutoffTime)

      totalFound += found
      totalMatched += matched
      totalNew += newCount
      if (error) {
        totalFailed++
        errors.push(`${account.name}: ${error}`)
      }

      // 更新 last_crawled_at
      await client
        .from('accounts')
        .update({ last_crawled_at: new Date().toISOString() })
        .eq('id', account.id)

      // 实时更新日志进度
      await client
        .from('crawl_logs')
        .update({
          cursor_position: cursor,
          accounts_crawled: startCursor + accountsProcessed,
          articles_found: totalFound,
          articles_new: totalNew,
          articles_matched: totalMatched,
        })
        .eq('id', logId)

      if (accountsProcessed % 10 === 0) {
        console.log(`[Crawl] Progress: ${cursor}/${totalAccounts} accounts, ${totalNew} new articles, ${Math.round(elapsed / 1000)}s elapsed`)
      }
    } catch (accountError: any) {
      totalFailed++
      errors.push(`${account.name}: ${accountError.message}`)
      console.error(`[Crawl] [${cursor}/${totalAccounts}] ${account.name} ERROR:`, accountError.message)

      try {
        await client.from('accounts')
          .update({ last_crawled_at: new Date().toISOString() })
          .eq('id', account.id)
      } catch {}
    }
  }

  // 确定最终状态
  const allDone = !timedOut && cursor >= totalAccounts
  const finalStatus = allDone
    ? (totalFailed > 0 ? 'partial' : 'success')
    : 'partial'

  const finalMessage = timedOut
    ? `采集时间接近上限，已暂停（已处理 ${cursor}/${totalAccounts}，可继续采集）`
    : errors.length > 0
      ? errors.slice(0, 20).join('; ')
      : null

  // 更新最终日志
  await client
    .from('crawl_logs')
    .update({
      status: finalStatus,
      finished_at: allDone ? new Date().toISOString() : null, // 未完成不设置 finished_at
      cursor_position: cursor,
      total_accounts: totalAccounts,
      accounts_crawled: startCursor + accountsProcessed,
      articles_found: totalFound,
      articles_new: totalNew,
      articles_matched: totalMatched,
      message: finalMessage,
    })
    .eq('id', logId)

  // 清理超过4天的历史文章（仅在所有账号处理完时执行）
  if (allDone) {
    const cutoffDate = new Date(cutoffTime).toISOString()
    await client.from('articles').delete().lt('published_at', cutoffDate)
  }

  const elapsed = Date.now() - startTime
  const message = timedOut
    ? `采集暂停: 已处理 ${cursor}/${totalAccounts} 个账号, 新增 ${totalNew} 篇, 耗时 ${Math.round(elapsed / 1000)}s, 可继续采集`
    : `采集完成: ${startCursor + accountsProcessed}个账号, 发现${totalFound}篇, 新增${totalNew}篇, 失败${totalFailed}个, 耗时${Math.round(elapsed / 1000)}s`

  return {
    message,
    accounts_crawled: startCursor + accountsProcessed,
    accounts_failed: totalFailed,
    articles_found: totalFound,
    articles_new: totalNew,
    articles_matched: totalMatched,
    cursor_position: cursor,
    total_accounts: totalAccounts,
    timed_out: timedOut,
    all_done: allDone,
    elapsed_seconds: Math.round(elapsed / 1000),
    errors,
  }
}
