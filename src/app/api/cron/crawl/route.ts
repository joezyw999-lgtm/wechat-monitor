import { NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabase'
import { fetchAccountArticles, matchKeywords } from '@/lib/api-client'
import { filterAccountsByCrawlLimit, recordAccountCrawl, canAutoCrawlToday, isWeekend } from '@/lib/crawl-limit'
import { normalizeTitleForDedup, dedupArticlesByTitle } from '@/lib/title-normalize'

export const runtime = 'nodejs'
export const maxDuration = 300

const SAFE_TIME_LIMIT_MS = 260 * 1000
const STALE_LOG_MINUTES = 10

/**
 * 清理超时的运行中日志
 */
async function cleanupStaleLogs(client: any) {
  const staleThreshold = new Date(Date.now() - STALE_LOG_MINUTES * 60 * 1000).toISOString()
  const { data: staleLogs } = await client
    .from('crawl_logs')
    .select('id, started_at, cursor_position, total_accounts, accounts_crawled')
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
          message: `定时采集超时自动标记（已处理 ${crawled}/${total} 个账号，游标位置 ${cursor}）`,
        })
        .eq('id', log.id)
    }
    console.log(`[Cron Crawl] Cleaned up ${staleLogs.length} stale running logs`)
  }
}

/**
 * 查找可恢复的采集任务
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
 * 处理单个公众号
 */
async function processOneAccount(
  client: any,
  account: any,
  apiKey: string,
  articleCount: number,
  keywords: string[],
  blockKeywords: string[],
  cutoffTime: number,
) {
  const result = await fetchAccountArticles(apiKey, account.wx_id, articleCount)

  if (!result.success) {
    return { found: 0, matched: 0, newCount: 0, dedupSkipped: 0, oldSkipped: 0, error: result.error }
  }

  const found = result.articles.length

  const recentArticles = result.articles.filter((article: any) => {
    const pubTime = article.published_at || article.publish_time
    if (!pubTime) return false
    const timestamp = typeof pubTime === 'number' ? pubTime * 1000 : new Date(pubTime).getTime()
    return !isNaN(timestamp) && timestamp >= cutoffTime
  })
  const oldSkipped = found - recentArticles.length

  const matchedArticles: Array<{ article: any; matchedKw: string[] }> = []
  for (const article of recentArticles) {
    const matchedKw = matchKeywords(article.title, article.digest || '', keywords)
    if (matchedKw.length > 0) {
      matchedArticles.push({ article, matchedKw })
    }
  }
  // 屏蔽关键词过滤
  let blocked = 0
  const filteredAfterBlock = matchedArticles.filter(item => {
    const title = item.article.title || ''
    const digest = item.article.digest || ''
    const isBlocked = blockKeywords.some(kw => kw && (title.includes(kw) || digest.includes(kw)))
    if (isBlocked) blocked++
    return !isBlocked
  })
  const matched = filteredAfterBlock.length
  blocked = matched - filteredAfterBlock.length

  if (filteredAfterBlock.length === 0) {
    return { found, matched: 0, newCount: 0, dedupSkipped: 0, oldSkipped, blockSkipped: blocked }
  }

  // URL去重
  const urls = filteredAfterBlock.map(a => a.article.url).filter(Boolean)
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

  let filteredByUrl = filteredAfterBlock.filter(a => !existingUrls.has(a.article.url))
  const urlDedupSkipped = filteredAfterBlock.length - filteredByUrl.length

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
      console.error(`[Cron Crawl] ${account.name} insert error:`, insertError.message)
      return { found, matched, newCount: 0, dedupSkipped, oldSkipped, blockSkipped: blocked, error: insertError.message }
    }
    newCount = insertData.length
  }

  return { found, matched, newCount, dedupSkipped, oldSkipped, blockSkipped: blocked }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const client = getSupabaseServiceClient()

    // Step 0: 清理超时日志
    await cleanupStaleLogs(client)

    // 判断今天是否可以自动抓取
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

      return NextResponse.json({ success: true, skipped: true, reason })
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

    // 按频率限制过滤
    const { allowedAccounts: finalAccounts, skipReason } = await filterAccountsByCrawlLimit(
      accounts,
      client
    )

    if (skipReason.weeklyLimit > 0) {
      console.log(`[Cron Crawl] Skipped ${skipReason.weeklyLimit} accounts by weekly limit`)
    }

    // Get active include keywords（type=include 或 type IS NULL，兼容历史数据）
    const { data: keywordsData } = await client
      .from('keywords')
      .select('word')
      .eq('status', 'active')
      .or('type.eq.include,type.is.null')
    const keywords = keywordsData?.map((k: any) => k.word) || []

    // Get active exclude keywords (屏蔽词过滤)
    const { data: blockKeywordsData } = await client
      .from('keywords')
      .select('word')
      .eq('status', 'active')
      .eq('type', 'exclude')
    const blockKeywords = blockKeywordsData?.map((k: any) => k.word) || []

    const cutoffTime = Date.now() - 4 * 24 * 60 * 60 * 1000
    const startTime = Date.now()

    // Step 1: 检查是否有可恢复的任务
    const resumableLog = await findResumableLog(client)

    if (resumableLog && finalAccounts.length > 0) {
      console.log(`[Cron Crawl] Resuming from log ${resumableLog.id}, cursor=${resumableLog.cursor_position}, total=${resumableLog.total_accounts}`)

      const cursorPos = resumableLog.cursor_position || 0
      const remainingAccounts = finalAccounts.slice(cursorPos)

      if (remainingAccounts.length === 0) {
        await client.from('crawl_logs').update({
          status: 'success',
          finished_at: new Date().toISOString(),
          message: '恢复采集：所有公众号已完成',
        }).eq('id', resumableLog.id)

        return NextResponse.json({
          success: true,
          message: '所有公众号已采集完成',
          resumed: true,
          log_id: resumableLog.id,
        })
      }

      await client.from('crawl_logs').update({
        status: 'running',
        message: `定时采集恢复，从第 ${cursorPos + 1} 个账号开始`,
      }).eq('id', resumableLog.id)

      const result = await crawlAccounts(
        client, remainingAccounts, apiKey, articleCount, keywords, blockKeywords, cutoffTime,
        resumableLog.id, cursorPos,
        remainingAccounts.length,
        resumableLog.articles_found || 0,
        resumableLog.articles_new || 0,
        resumableLog.articles_matched || 0,
        startTime
      )

      // 记录本次自动抓取的公众号
      if (result.successAccountIds && result.successAccountIds.length > 0) {
        await recordAccountCrawl(result.successAccountIds, client)
      }

      // 全部完成时清理旧文章
      if (result.all_done) {
        const cutoffDate = new Date(cutoffTime).toISOString()
        await client.from('articles').delete().lt('published_at', cutoffDate)
      }

      return NextResponse.json({
        success: true,
        ...result,
        resumed: true,
        log_id: resumableLog.id,
        accountsTotal: accounts.length,
        skippedByLimit: accounts.length - finalAccounts.length,
      })
    }

    // 全新采集
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

    console.log(`[Cron Crawl] Starting fresh crawl: ${finalAccounts.length} accounts`)

    const { data: logData } = await client
      .from('crawl_logs')
      .insert({
        status: 'running',
        message: '定时采集开始',
        keywords_used: null,
        total_accounts: finalAccounts.length,
        cursor_position: 0,
        account_ids: finalAccounts.map((a: any) => a.id).join(','),
      })
      .select()
      .single()

    const result = await crawlAccounts(
      client, finalAccounts, apiKey, articleCount, keywords, blockKeywords, cutoffTime,
      logData.id, 0, finalAccounts.length,
      0, 0, 0, startTime
    )

    // 记录本次自动抓取的公众号
    if (result.successAccountIds && result.successAccountIds.length > 0) {
      await recordAccountCrawl(result.successAccountIds, client)
    }

    // 全部完成时清理旧文章
    if (result.all_done) {
      const cutoffDate = new Date(cutoffTime).toISOString()
      await client.from('articles').delete().lt('published_at', cutoffDate)
    }

    return NextResponse.json({
      success: true,
      ...result,
      resumed: false,
      log_id: logData.id,
      accountsTotal: accounts.length,
      skippedByLimit: accounts.length - finalAccounts.length,
    })
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

async function crawlAccounts(
  client: any,
  accounts: any[],
  apiKey: string,
  articleCount: number,
  keywords: string[],
  blockKeywords: string[],
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
  const successAccountIds: string[] = []
  let cursor = startCursor
  let timedOut = false

  for (const account of accounts) {
    const elapsed = Date.now() - startTime
    if (elapsed >= SAFE_TIME_LIMIT_MS) {
      console.log(`[Cron Crawl] Approaching time limit (${Math.round(elapsed / 1000)}s), stopping at cursor=${cursor}`)
      timedOut = true
      break
    }

    accountsProcessed++
    cursor++

    try {
      const { found, matched, newCount, dedupSkipped, oldSkipped, error } =
        await processOneAccount(client, account, apiKey, articleCount, keywords, blockKeywords, cutoffTime)

      totalFound += found
      totalMatched += matched
      totalNew += newCount
      if (error) {
        totalFailed++
        errors.push(`${account.name}: ${error}`)
      } else {
        successAccountIds.push(account.id)
      }

      await client
        .from('accounts')
        .update({ last_crawled_at: new Date().toISOString() })
        .eq('id', account.id)

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
        console.log(`[Cron Crawl] Progress: ${cursor}/${totalAccounts} accounts, ${totalNew} new articles, ${Math.round(elapsed / 1000)}s elapsed`)
      }
    } catch (accountError: any) {
      totalFailed++
      errors.push(`${account.name}: ${accountError.message}`)
      console.error(`[Cron Crawl] [${cursor}/${totalAccounts}] ${account.name} ERROR:`, accountError.message)

      try {
        await client.from('accounts')
          .update({ last_crawled_at: new Date().toISOString() })
          .eq('id', account.id)
      } catch {}
    }
  }

  const allDone = !timedOut && cursor >= totalAccounts
  const finalStatus = allDone
    ? (totalFailed > 0 ? 'partial' : 'success')
    : 'partial'

  const finalMessage = timedOut
    ? `定时采集时间接近上限，已暂停（已处理 ${cursor}/${totalAccounts}，下次自动继续）`
    : errors.length > 0
      ? errors.slice(0, 20).join('; ')
      : null

  await client
    .from('crawl_logs')
    .update({
      status: finalStatus,
      finished_at: allDone ? new Date().toISOString() : null,
      cursor_position: cursor,
      total_accounts: totalAccounts,
      accounts_crawled: startCursor + accountsProcessed,
      articles_found: totalFound,
      articles_new: totalNew,
      articles_matched: totalMatched,
      message: finalMessage,
    })
    .eq('id', logId)

  const elapsed = Date.now() - startTime
  const message = timedOut
    ? `定时采集暂停: 已处理 ${cursor}/${totalAccounts} 个账号, 新增 ${totalNew} 篇, 耗时 ${Math.round(elapsed / 1000)}s, 下次自动继续`
    : `定时采集完成: ${startCursor + accountsProcessed}个账号, 发现${totalFound}篇, 新增${totalNew}篇, 失败${totalFailed}个, 耗时${Math.round(elapsed / 1000)}s`

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
    successAccountIds,
    errors,
  }
}
