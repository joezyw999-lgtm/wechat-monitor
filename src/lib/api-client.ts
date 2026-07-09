import axios from 'axios'

const API_BASE = 'https://api.getoneapi.com'

interface ArticleData {
  title: string
  url: string
  digest: string
  cover: string
  author: string
  content: string
  publish_time: number
  msg_id?: string
}

interface CrawlResult {
  success: boolean
  articles: ArticleData[]
  error?: string
}

export async function fetchAccountArticles(
  apiKey: string,
  bizId: string
): Promise<CrawlResult> {
  try {
    const response = await axios.post(
      `${API_BASE}/api/wechat/account/articles`,
      { biz_id: bizId, need_content: false },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 60000
      }
    )

    if (response.data.code === 200) {
      const articles = response.data.data?.articles || []
      return { success: true, articles }
    } else {
      return { success: false, articles: [], error: response.data.message || 'API returned error' }
    }
  } catch (error: any) {
    return { success: false, articles: [], error: error.message || 'Request failed' }
  }
}

export function matchKeywords(
  title: string,
  digest: string,
  keywords: string[]
): string[] {
  const text = `${title} ${digest}`.toLowerCase()
  return keywords.filter(kw => text.includes(kw.toLowerCase()))
}
