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
  published_at?: string
  msg_id?: string
}

interface CrawlResult {
  success: boolean
  articles: ArticleData[]
  error?: string
}

export async function fetchAccountArticles(
  apiKey: string,
  bizId: string,
  count: number = 20
): Promise<CrawlResult> {
  try {
    // Use document-specified request parameters
    const response = await axios.post(
      `${API_BASE}/api/wechat-mp-v2/fetch_mp_article_list`,
      {
        username: bizId,
        page_size: count,
        offset: '',
        item_show_type: 0,
        raw: false
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        timeout: 60000
      }
    )

    if (response.data.code === 200) {
      const rawArticles = response.data.data?.articles || []
      
      // Parse based on raw: false response structure
      const articles: ArticleData[] = rawArticles
        .map((item: any) => {
          // raw: false returns flattened structure
          const article = item?.appMsg || item
          
          // Try multiple possible field locations
          const baseInfo = article.baseInfo || article
          const detailInfo = article.detailInfo || []
          const detail = Array.isArray(detailInfo) ? detailInfo[0] : detailInfo
          
          // Extract fields from various possible locations
          const title = detail?.title || article?.title || baseInfo?.title || ''
          const url = detail?.contentUrl || detail?.content_url || article?.url || article?.contentUrl || ''
          const digest = detail?.digest || article?.digest || ''
          const cover = detail?.coverImgUrl || detail?.cover_img_url || article?.coverImgUrl || ''
          const author = detail?.author || article?.author || ''
          const createTime = baseInfo?.createTime || article?.createTime || article?.create_time || 0
          const appMsgId = baseInfo?.appMsgId || article?.appMsgId || article?.msg_id
          
          if (!url) return null
          
          return {
            title,
            url,
            digest,
            cover,
            author,
            content: '', // not fetching full content
            publish_time: createTime,
            published_at: createTime
              ? new Date(createTime * 1000).toISOString()
              : undefined,
            msg_id: appMsgId ? String(appMsgId) : undefined,
          } as ArticleData
        })
        .filter(Boolean) as ArticleData[]

      return { success: true, articles }
    } else {
      return { success: false, articles: [], error: response.data.message || 'API returned error' }
    }
  } catch (error: any) {
    return { success: false, articles: [], error: error.message || 'Request failed' }
  }
}

export async function fetchAccountBalance(apiKey: string): Promise<number | null> {
  try {
    const response = await axios.post(
      `${API_BASE}/back/user/balance`,
      {},
      { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 10000 }
    )
    const data = response.data
    if (data.code === 200 && data.data != null) {
      if (typeof data.data === 'number') return data.data
      if (typeof data.data.balance === 'number') return data.data.balance
      if (typeof data.data === 'object') {
        const v = Object.values(data.data).find(x => typeof x === 'number')
        if (typeof v === 'number') return v
      }
    }
    return null
  } catch {
    return null
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
