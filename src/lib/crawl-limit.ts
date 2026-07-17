import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 抓取频率限制规则
 *
 * 全局限制（仅自动抓取受影响，手动抓取不受限）：
 * 1. 周六、周日禁止自动抓取
 * 2. 法定节假日禁止自动抓取
 * 3. 每个公众号每周最多自动抓取 5 次
 */

// 中国法定节假日（2025-2026），后续可扩展为配置或接口
const CHINA_HOLIDAYS: string[] = [
  // 2025 年
  '2025-01-01', // 元旦
  '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31', '2025-02-01', '2025-02-02', '2025-02-03', '2025-02-04', // 春节
  '2025-04-04', '2025-04-05', '2025-04-06', // 清明
  '2025-05-01', '2025-05-02', '2025-05-03', '2025-05-04', '2025-05-05', // 劳动节
  '2025-05-31', '2025-06-01', '2025-06-02', // 端午
  '2025-10-01', '2025-10-02', '2025-10-03', '2025-10-04', '2025-10-05', '2025-10-06', '2025-10-07', '2025-10-08', // 国庆中秋

  // 2026 年
  '2026-01-01', '2026-01-02', '2026-01-03', // 元旦
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23', '2026-02-24', // 春节
  '2026-04-04', '2026-04-05', '2026-04-06', // 清明
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05', // 劳动节
  '2026-06-19', '2026-06-20', '2026-06-21', // 端午
  '2026-09-25', '2026-09-26', '2026-09-27', // 中秋
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', // 国庆
]

const MAX_WEEKLY_CRAWLS = 5

/**
 * 判断某天是否为周末
 */
export function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6
}

/**
 * 判断某天是否为法定节假日
 */
export function isHoliday(date: Date): boolean {
  const dateStr = formatDate(date)
  return CHINA_HOLIDAYS.includes(dateStr)
}

/**
 * 判断今天是否可以自动抓取（非周末 + 非节假日）
 */
export function canAutoCrawlToday(date: Date = new Date()): {
  allowed: boolean
  reason?: 'weekend' | 'holiday'
} {
  if (isWeekend(date)) {
    return { allowed: false, reason: 'weekend' }
  }
  if (isHoliday(date)) {
    return { allowed: false, reason: 'holiday' }
  }
  return { allowed: true }
}

/**
 * 获取本周起止日期（周一 00:00 ~ 周日 23:59:59）
 * 按自然周计算，周一为一周第一天
 */
export function getWeekRange(date: Date = new Date()): { start: Date; end: Date } {
  const d = new Date(date)
  const day = d.getDay() // 0=周日, 1=周一, ..., 6=周六
  const diffToMonday = day === 0 ? 6 : day - 1

  const start = new Date(d)
  start.setDate(d.getDate() - diffToMonday)
  start.setHours(0, 0, 0, 0)

  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  end.setHours(23, 59, 59, 999)

  return { start, end }
}

/**
 * 检查公众号本周是否还能自动抓取
 * @param weeklyCount 本周已自动抓取次数
 */
export function canCrawlThisWeek(weeklyCount: number): boolean {
  return weeklyCount < MAX_WEEKLY_CRAWLS
}

export { MAX_WEEKLY_CRAWLS }

/**
 * 根据频率限制过滤出今天可自动抓取的公众号
 * @returns 过滤后的公众号列表 + 被跳过的原因统计
 */
export async function filterAccountsByCrawlLimit<T extends { id: string; name: string }>(
  accounts: T[],
  client: SupabaseClient<any>,
  now: Date = new Date(),
): Promise<{
  allowedAccounts: T[]
  skipReason: {
    weekend: boolean
    holiday: boolean
    weeklyLimit: number
  }
}> {
  const todayCheck = canAutoCrawlToday(now)

  if (!todayCheck.allowed) {
    return {
      allowedAccounts: [],
      skipReason: {
        weekend: todayCheck.reason === 'weekend',
        holiday: todayCheck.reason === 'holiday',
        weeklyLimit: 0,
      },
    }
  }

  // 查询每个公众号本周已自动抓取次数
  const { start: weekStart } = getWeekRange(now)
  const accountIds = accounts.map(a => a.id)

  const { data: crawlLogs } = await client
    .from('account_crawl_logs')
    .select('account_id')
    .in('account_id', accountIds)
    .gte('crawled_at', weekStart.toISOString())

  // 统计每个公众号本周抓取次数
  const countMap = new Map<string, number>()
  if (crawlLogs) {
    for (const log of crawlLogs) {
      const id = (log as any).account_id
      countMap.set(id, (countMap.get(id) || 0) + 1)
    }
  }

  let weeklyLimitSkip = 0
  const allowedAccounts = accounts.filter(account => {
    const count = countMap.get(account.id) || 0
    if (count >= MAX_WEEKLY_CRAWLS) {
      weeklyLimitSkip++
      return false
    }
    return true
  })

  return {
    allowedAccounts,
    skipReason: {
      weekend: false,
      holiday: false,
      weeklyLimit: weeklyLimitSkip,
    },
  }
}

/**
 * 记录公众号自动抓取历史（用于周次数统计）
 */
export async function recordAccountCrawl(
  accountIds: string[],
  client: SupabaseClient<any>,
): Promise<void> {
  if (accountIds.length === 0) return

  const now = new Date().toISOString()
  const records = accountIds.map(id => ({
    account_id: id,
    crawled_at: now,
  }))

  const { error } = await client
    .from('account_crawl_logs')
    .insert(records)

  if (error) {
    console.error('[CrawlLimit] recordAccountCrawl error:', error.message)
  }
}

function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
