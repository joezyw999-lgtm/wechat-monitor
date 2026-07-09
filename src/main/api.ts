import axios, { AxiosInstance } from 'axios';
import { getDatabase } from './database';

const API_BASE_URL = 'https://api.getoneapi.com';
const ARTICLE_LIST_PATH = '/api/wechat-mp-v2/fetch_mp_article_list';
const TIMEOUT_SECONDS = 45;

interface ArticleItem {
  title: string;
  account_name?: string;
  username?: string;
  publish_time?: string | number;
  url?: string;
  link?: string;
  summary?: string;
  cover?: string;
  cover_url?: string;
  article_unique_key?: string;
  md5?: string;
}

interface FetchArticleResponse {
  code: number;
  message: string;
  data: {
    list: ArticleItem[];
    next_offset?: string;
    is_end?: boolean;
  };
}

function createClient(): AxiosInstance {
  return axios.create({
    baseURL: API_BASE_URL,
    timeout: TIMEOUT_SECONDS * 1000,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function getApiKey(): string {
  const db = getDatabase();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('api_key') as { value: string } | undefined;
  return row?.value || '';
}

export async function fetchArticles(
  username: string,
  pageSize: number = 20,
  offset: string = ''
): Promise<FetchArticleResponse> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('API Key 未配置，请先在设置中配置 API Key');
  }

  const client = createClient();
  const response = await client.post<FetchArticleResponse>(
    ARTICLE_LIST_PATH,
    {
      username,
      page_size: pageSize,
      offset,
      item_show_type: '0',
      raw: false,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );

  return response.data;
}

export function formatPublishTime(time: string | number | undefined): string {
  if (!time) return '';
  if (typeof time === 'number') {
    return new Date(time * 1000).toISOString().replace('T', ' ').substring(0, 19);
  }
  return time;
}

export interface CrawlResult {
  totalCount: number;
  newCount: number;
  matchedCount: number;
  errors: string[];
}

export async function crawlAccount(accountId: number, accountName: string, username: string): Promise<CrawlResult> {
  const db = getDatabase();
  const result: CrawlResult = { totalCount: 0, newCount: 0, matchedCount: 0, errors: [] };

  const logStmt = db.prepare(`
    INSERT INTO crawl_logs (account_id, account_name, username, status, total_count, new_count, matched_count, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const startTime = new Date().toISOString();

  try {
    const response = await fetchArticles(username);

    if (response.code !== 200) {
      throw new Error(`API 返回错误: ${response.message} (code: ${response.code})`);
    }

    const articles = response.data?.list || [];
    result.totalCount = articles.length;

    const enabledKeywords = db.prepare('SELECT keyword FROM keywords WHERE status = 1').all() as { keyword: string }[];
    const keywordList = enabledKeywords.map((k) => k.keyword);

    const insertArticle = db.prepare(`
      INSERT OR IGNORE INTO articles 
      (title, account_name, username, publish_time, original_url, summary, cover_url, article_unique_key, matched_keywords)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const article of articles) {
      const originalUrl = article.url || article.link || '';
      const uniqueKey = article.article_unique_key || article.md5 || '';
      const publishTime = formatPublishTime(article.publish_time);

      const matched: string[] = [];
      const title = article.title || '';
      const summary = article.summary || '';
      const textToMatch = title + ' ' + summary;

      for (const kw of keywordList) {
        if (textToMatch.includes(kw)) {
          matched.push(kw);
        }
      }

      const stmt = insertArticle.run(
        title,
        article.account_name || accountName,
        username,
        publishTime,
        originalUrl,
        summary,
        article.cover || article.cover_url || '',
        uniqueKey,
        matched.join(',')
      );

      if (stmt.changes > 0) {
        result.newCount++;
        if (matched.length > 0) {
          result.matchedCount++;
        }
      }
    }

    db.prepare('UPDATE accounts SET last_crawl_at = ?, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), new Date().toISOString(), accountId);

    logStmt.run(
      accountId, accountName, username, 'success',
      result.totalCount, result.newCount, result.matchedCount, ''
    );
  } catch (error: any) {
    const errMsg = error.message || String(error);
    result.errors.push(errMsg);
    logStmt.run(
      accountId, accountName, username, 'failed',
      result.totalCount, result.newCount, result.matchedCount, errMsg
    );
  }

  return result;
}

export async function crawlAllAccounts(): Promise<Map<number, CrawlResult>> {
  const db = getDatabase();
  const accounts = db.prepare('SELECT id, name, username FROM accounts WHERE status = 1').all() as {
    id: number;
    name: string;
    username: string;
  }[];

  const results = new Map<number, CrawlResult>();

  for (const account of accounts) {
    const result = await crawlAccount(account.id, account.name, account.username);
    results.set(account.id, result);
  }

  return results;
}
