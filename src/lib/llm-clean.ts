import { getSupabaseServiceClient } from './supabase'

export interface LLMCleanResult {
  company_name: string
  recruit_type: string
  recruit_batch: string
  standard_title: string
  dedup_key: string
}

export interface ArticleForClean {
  title: string
  summary: string
  original_url: string
  published_at: string
}

// 从 settings 表或环境变量读取 LLM 配置
async function getLLMConfig(): Promise<{ baseUrl: string; apiKey: string; model: string }> {
  let baseUrl = process.env.LLM_API_BASE || ''
  let apiKey = process.env.LLM_API_KEY || ''
  let model = process.env.LLM_MODEL || 'deepseek-chat'

  try {
    const client = getSupabaseServiceClient()
    const { data } = await client
      .from('settings')
      .select('key, value')
      .in('key', ['llm_api_base', 'llm_api_key', 'llm_model'])

    if (data && data.length > 0) {
      const settingsMap: Record<string, string> = {}
      data.forEach((item: { key: string; value: string }) => {
        settingsMap[item.key] = item.value
      })
      if (settingsMap.llm_api_base) baseUrl = settingsMap.llm_api_base
      if (settingsMap.llm_api_key) apiKey = settingsMap.llm_api_key
      if (settingsMap.llm_model) model = settingsMap.llm_model
    }
  } catch {
    // settings 表查询失败就用环境变量
  }

  return { baseUrl, apiKey, model }
}

const SYSTEM_PROMPT = `你是一个招聘信息标准化助手。请对输入的公众号招聘文章进行标题标准化和信息抽取。

任务说明：
1. 从标题和摘要中提取：公司名称、招聘类型、招聘批次
2. 生成标准展示标题（去除营销词、表情、特殊符号，保留核心信息）
3. 生成去重 key（公司名+招聘类型+招聘批次的组合，用于判断是否为同一招聘）

输出要求：
- 严格输出 JSON 数组，不要输出任何解释文字
- 每个输入对应一个输出对象，顺序与输入一致
- 不确定的字段返回空字符串 ""
- 不要编造公司名，识别不到就返回空
- 公司名称要完整规范，不要简称
- 招聘类型：校招/实习/社招/春招/秋招/暑期实习/管培生/其他
- 招聘批次：格式如 "2026秋季"、"2025暑期"，识别不到年份就只写季节

JSON 格式：
[
  {
    "company_name": "公司全称",
    "recruit_type": "校招",
    "recruit_batch": "2026秋季",
    "standard_title": "标准标题",
    "dedup_key": "公司名_校招_2026秋季"
  }
]`

function buildUserPrompt(articles: ArticleForClean[]): string {
  return JSON.stringify(
    articles.map((a, i) => ({
      index: i,
      title: a.title,
      summary: a.summary,
    })),
    null,
    2,
  )
}

export async function cleanArticlesWithLLM(
  articles: ArticleForClean[],
  batchSize: number = 15,
): Promise<(LLMCleanResult | null)[]> {
  const { baseUrl, apiKey, model } = await getLLMConfig()

  // 没有配置 LLM，全部返回 null，走规则降级
  if (!baseUrl || !apiKey) {
    return articles.map(() => null)
  }

  const results: (LLMCleanResult | null)[] = new Array(articles.length).fill(null)

  // 分批处理
  for (let i = 0; i < articles.length; i += batchSize) {
    const batch = articles.slice(i, i + batchSize)
    const batchStart = i

    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildUserPrompt(batch) },
          ],
          temperature: 0,
          response_format: { type: 'json_object' },
        }),
      })

      if (!response.ok) {
        throw new Error(`LLM API 返回 ${response.status}`)
      }

      const data = await response.json()
      const content = data.choices?.[0]?.message?.content || '[]'

      let parsed: LLMCleanResult[] = []
      try {
        const raw = JSON.parse(content)
        // 兼容两种格式：直接数组 或 包了一层的对象
        if (Array.isArray(raw)) {
          parsed = raw
        } else if (Array.isArray(raw.results)) {
          parsed = raw.results
        } else if (Array.isArray(raw.data)) {
          parsed = raw.data
        }
      } catch {
        throw new Error('LLM 返回 JSON 解析失败')
      }

      // 按索引回填结果
      parsed.forEach((item, idx) => {
        const globalIdx = batchStart + idx
        if (globalIdx < articles.length) {
          results[globalIdx] = {
            company_name: item.company_name || '',
            recruit_type: item.recruit_type || '',
            recruit_batch: item.recruit_batch || '',
            standard_title: item.standard_title || '',
            dedup_key: item.dedup_key || '',
          }
        }
      })
    } catch (error) {
      console.error(`[LLM] 批次 ${batchStart}-${batchStart + batch.length} 清洗失败:`, error)
      // 失败的批次保持 null，后续走规则降级
    }
  }

  return results
}
