// 招聘文章去重工具
// 第一版：纯规则，不使用大模型

// ==================== 常见营销词（用于标题标准化） ====================
const MARKETING_WORDS = [
  '重磅',
  '最新',
  '火热',
  '正式启动',
  '火热开启',
  '火热进行中',
  '报名中',
  '火热报名',
  '速投',
  '快投',
  '紧急招聘',
  '急招',
  '热招',
  '校招',
  '春招',
  '秋招',
  '实习',
  '社招',
  '内推',
  '内推码',
  '直推',
  '提前批',
  '第一批',
  '第二批',
  '第三批',
  '第四批',
  '第五批',
  '补录',
  '春招补录',
  '秋招补录',
  '校园招聘',
  '社会招聘',
  '春季招聘',
  '秋季招聘',
  '暑期实习',
  '寒假实习',
  '日常实习',
]

// 按长度从长到短排序，避免短词先替换导致长词匹配不到
MARKETING_WORDS.sort((a, b) => b.length - a.length)

// ==================== 公司名识别关键词 ====================
// 常见公司后缀
const COMPANY_SUFFIXES = [
  '集团',
  '股份',
  '有限公司',
  '有限责任公司',
  '公司',
  '银行',
  '证券',
  '基金',
  '保险',
  '科技',
  '互联网',
  '集团有限公司',
  '控股',
  '实业',
  '投资',
  '资产管理',
  '咨询',
  '事务所',
  '研究院',
  '研究所',
  '大学',
  '学院',
  '医院',
  '医药',
  '能源',
  '电力',
  '石油',
  '化工',
  '汽车',
  '制造',
  '建设',
  '建筑',
  '地产',
  '置业',
  '物流',
  '贸易',
  '传媒',
  '文化',
  '教育',
  '体育',
  '旅游',
  '餐饮',
  '酒店',
]

COMPANY_SUFFIXES.sort((a, b) => b.length - a.length)

// 常见招聘类型
const RECRUIT_TYPES_MAP: Record<string, string> = {
  '校园招聘': '校园招聘',
  '春季招聘': '春季招聘',
  '秋季招聘': '秋季招聘',
  '暑期实习': '暑期实习',
  '寒假实习': '寒假实习',
  '日常实习': '日常实习',
  '社会招聘': '社会招聘',
  '实习招聘': '实习招聘',
  '管培生': '管培生',
  '春招': '春季招聘',
  '秋招': '秋季招聘',
  '校招': '校园招聘',
  '社招': '社会招聘',
  '实习': '实习招聘',
}

// 年份/批次识别正则
const BATCH_PATTERNS = [
  // 2026届 / 2025届
  /(\d{4})届/g,
  // 2026年 / 2025年度
  /(\d{4})年/g,
  /(\d{4})年度/g,
  // 第X批
  /第([一二三四五六七八九十\d]+)批/g,
  // 春招/秋招 + 年份
  /(\d{4})(春招|秋招|校招)/g,
  // 提前批
  /(提前批)/g,
  // 补录
  /(补录)/g,
]

/**
 * 标题标准化
 * 1. 去除空格、换行、制表符
 * 2. 去除标点符号、表情、特殊字符（保留中英文、数字）
 * 3. 统一小写
 * 4. 去除常见营销词
 */
export function normalizeTitle(title: string): string {
  if (!title) return ''

  let result = title
    .replace(/[\s\r\n\t]+/g, '')                    // 空格、换行、制表符
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')      // 只保留中文、英文、数字
    .toLowerCase()

  // 去除营销词（循环多次，避免替换后又组合出新的营销词）
  let prev = ''
  let iterations = 0
  while (prev !== result && iterations < 5) {
    prev = result
    for (const word of MARKETING_WORDS) {
      // 营销词也做同样的标准化再比较
      const normalizedWord = word
        .replace(/[\s\r\n\t]+/g, '')
        .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
        .toLowerCase()
      if (normalizedWord && result.includes(normalizedWord)) {
        result = result.split(normalizedWord).join('')
      }
    }
    iterations++
  }

  return result.trim()
}

/**
 * 从标题/摘要中提取公司名称
 * 策略：
 * 1. 找包含常见公司后缀的词
 * 2. 优先取最靠前的
 */
export function extractCompanyName(text: string): string {
  if (!text) return ''

  // 清洗文本，保留中文、英文、数字和常用标点以便分句
  const cleaned = text.replace(/[\r\n\t]+/g, ' ')

  // 按常见分隔符分词
  const segments = cleaned.split(/[，。！？、；：【】「」《》（）()\[\]【】"'"'·\-—\s]+/).filter(Boolean)

  for (const seg of segments) {
    for (const suffix of COMPANY_SUFFIXES) {
      if (seg.endsWith(suffix) && seg.length > suffix.length + 1) {
        // 提取公司名（包含后缀）
        return seg.trim()
      }
    }
  }

  // 兜底：找文本中"XX公司/XX集团/XX银行"等模式
  for (const suffix of COMPANY_SUFFIXES) {
    const regex = new RegExp(`([\\u4e00-\\u9fa5a-zA-Z0-9]{2,20}${suffix})`, 'g')
    const match = cleaned.match(regex)
    if (match && match[0]) {
      return match[0]
    }
  }

  return ''
}

/**
 * 提取招聘类型
 */
export function extractRecruitType(text: string): string {
  if (!text) return ''

  for (const [keyword, type] of Object.entries(RECRUIT_TYPES_MAP)) {
    if (text.includes(keyword)) {
      return type
    }
  }

  return ''
}

/**
 * 提取招聘批次（年份/批次）
 */
export function extractRecruitBatch(text: string): string {
  if (!text) return ''

  const parts: string[] = []

  // 年份
  const yearMatch = text.match(/(\d{4})届/)
  if (yearMatch) {
    parts.push(`${yearMatch[1]}届`)
  } else {
    const yearMatch2 = text.match(/20(\d{2})/)
    if (yearMatch2) {
      parts.push(`20${yearMatch2[1]}`)
    }
  }

  // 批次
  if (text.includes('提前批')) {
    parts.push('提前批')
  } else if (text.includes('补录')) {
    parts.push('补录')
  } else {
    const batchMatch = text.match(/第([一二三四五六七八九十\d]+)批/)
    if (batchMatch) {
      parts.push(`第${batchMatch[1]}批`)
    }
  }

  return parts.join('')
}

/**
 * 生成去重 key
 * 只有当 company_name、recruit_type、recruit_batch 都能提取到时才生成
 */
export function generateDuplicateKey(
  title: string,
  summary: string
): {
  company_name: string
  recruit_type: string
  recruit_batch: string
  duplicate_key: string | null
} {
  const combined = `${title} ${summary}`

  const companyName = extractCompanyName(combined)
  const recruitType = extractRecruitType(combined)
  const recruitBatch = extractRecruitBatch(combined)

  // 三个字段都能提取到才生成 duplicate_key
  if (companyName && recruitType && recruitBatch) {
    return {
      company_name: companyName,
      recruit_type: recruitType,
      recruit_batch: recruitBatch,
      duplicate_key: `${companyName}_${recruitType}_${recruitBatch}`,
    }
  }

  return {
    company_name: companyName,
    recruit_type: recruitType,
    recruit_batch: recruitBatch,
    duplicate_key: null,
  }
}

/**
 * 处理单篇文章的去重相关字段
 */
export function processArticleDedupFields(article: {
  title: string
  digest?: string
  summary?: string
}): {
  original_title: string
  normalized_title: string
  company_name: string
  recruit_type: string
  recruit_batch: string
  duplicate_key: string | null
} {
  const originalTitle = article.title || ''
  const normalizedTitle = normalizeTitle(originalTitle)
  const summary = article.digest || article.summary || ''
  const dedup = generateDuplicateKey(originalTitle, summary)

  return {
    original_title: originalTitle,
    normalized_title: normalizedTitle,
    company_name: dedup.company_name,
    recruit_type: dedup.recruit_type,
    recruit_batch: dedup.recruit_batch,
    duplicate_key: dedup.duplicate_key,
  }
}
