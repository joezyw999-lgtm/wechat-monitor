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
    const response = await axios.post(
      `${API_BASE}/api/wechat-mp-v2/fetch_mp_article_list`,
      { username: bizId, count },
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
      
      // Parse the nested structure: articles[i].appMsg.detailInfo[0]
      const articles: ArticleData[] = rawArticles
        .map((item: any) => {
          const appMsg = item?.appMsg
          if (!appMsg) return null
          
          const baseInfo = appMsg.baseInfo || {}
          const detailInfo = appMsg.detailInfo || []
          const detail = detailInfo[0] || {}
          
          if (!detail.contentUrl) return null
          
          return {
            title: detail.title || '',
            url: detail.contentUrl || '',
            digest: detail.digest || '',
            cover: detail.coverImgUrl || '',
            author: detail.author || '',
            content: '', // not fetching full content
            publish_time: baseInfo.createTime || 0,
            published_at: baseInfo.createTime
              ? new Date(baseInfo.createTime * 1000).toISOString()
              : undefined,
            msg_id: baseInfo.appMsgId ? String(baseInfo.appMsgId) : undefined,
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

export function matchKeywords(
  title: string,
  digest: string,
  keywords: string[]
): string[] {
  const text = `${title} ${digest}`.toLowerCase()
  return keywords.filter(kw => text.includes(kw.toLowerCase()))
}
