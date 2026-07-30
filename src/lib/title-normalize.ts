/**
 * 标题标准化工具
 * 用于"标题完全一致去重"场景
 * 只做基础标准化：去空格、全角半角转换，不做语义级别的处理
 */

/**
 * 全角字符转半角
 */
function toHalfWidth(str: string): string {
  let result = ''
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    // 全角空格
    if (code === 0x3000) {
      result += ' '
    }
    // 全角 ASCII 字符 (！～ 全角)
    else if (code >= 0xff01 && code <= 0xff5e) {
      result += String.fromCharCode(code - 0xfee0)
    } else {
      result += str.charAt(i)
    }
  }
  return result
}

/**
 * 标准化标题（用于精确去重）
 * 规则：
 * 1. 去掉首尾空格
 * 2. 合并多个空格为单个空格
 * 3. 全角转半角
 * 4. 统一中文标点（保持中文标点不变，只做全半角统一）
 * 5. 统一为小写
 */
export function normalizeTitleForDedup(title: string): string {
  if (!title) return ''

  let result = title.trim()

  // 全角转半角
  result = toHalfWidth(result)

  // 合并多个空格为单个空格
  result = result.replace(/\s+/g, ' ')

  // 统一小写（英文）
  result = result.toLowerCase()

  return result
}

/**
 * 从文章列表中按标题去重
 * 保留发布时间最新的，发布时间相同则保留先出现的
 */
export function dedupArticlesByTitle<T extends { title: string; published_at?: string }>(
  articles: T[]
): T[] {
  const titleMap = new Map<string, T>()

  for (const article of articles) {
    const normalized = normalizeTitleForDedup(article.title)
    if (!normalized) continue

    const existing = titleMap.get(normalized)
    if (!existing) {
      titleMap.set(normalized, article)
    } else {
      // 比较发布时间，保留更新的
      const existingTime = existing.published_at
        ? new Date(existing.published_at).getTime()
        : 0
      const currentTime = article.published_at
        ? new Date(article.published_at).getTime()
        : 0

      if (currentTime > existingTime) {
        titleMap.set(normalized, article)
      }
      // 发布时间相同或更早，保留先出现的
    }
  }

  return Array.from(titleMap.values())
}
