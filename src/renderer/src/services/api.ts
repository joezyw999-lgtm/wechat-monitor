import type { ElectronAPI } from '../../preload/index';

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

// Mock implementation for browser preview (non-Electron environment)
class MockAPI implements ElectronAPI {
  private mockAccounts = [
    { id: 1, name: 'AI科技评论', username: 'gh_abc123', status: 1, remark: 'AI领域', last_crawl_at: '2026-07-09 10:00:00', created_at: '2026-07-01', updated_at: '2026-07-09' },
    { id: 2, name: '出海笔记', username: 'gh_def456', status: 1, remark: '', last_crawl_at: '2026-07-09 09:00:00', created_at: '2026-07-02', updated_at: '2026-07-09' },
    { id: 3, name: '产品沉思录', username: 'gh_ghi789', status: 0, remark: '已停用', last_crawl_at: null, created_at: '2026-07-03', updated_at: '2026-07-08' },
  ];

  private mockKeywords = [
    { id: 1, keyword: 'AI', group_name: '技术', status: 1, remark: '', created_at: '2026-07-01', updated_at: '2026-07-01' },
    { id: 2, keyword: '大模型', group_name: '技术', status: 1, remark: '', created_at: '2026-07-01', updated_at: '2026-07-01' },
    { id: 3, keyword: '出海', group_name: '行业', status: 1, remark: '', created_at: '2026-07-02', updated_at: '2026-07-02' },
  ];

  private mockArticles = Array.from({ length: 25 }, (_, i) => ({
    id: i + 1,
    title: `关于AI大模型发展的第${i + 1}篇深度分析文章`,
    account_name: i % 2 === 0 ? 'AI科技评论' : '出海笔记',
    username: i % 2 === 0 ? 'gh_abc123' : 'gh_def456',
    publish_time: `2026-07-0${Math.min(9, Math.floor(i / 3) + 1)} 10:00:00`,
    original_url: 'https://mp.weixin.qq.com/s/example',
    summary: `这是第${i + 1}篇文章的摘要内容，涉及AI、大模型等前沿话题...`,
    cover_url: '',
    article_unique_key: `key_${i + 1}`,
    matched_keywords: i % 3 === 0 ? 'AI,大模型' : i % 3 === 1 ? 'AI' : '出海',
    is_read: i % 3 === 0 ? 1 : 0,
    crawled_at: `2026-07-0${Math.min(9, Math.floor(i / 3) + 1)} 10:30:00`,
  }));

  private mockLogs = [
    { id: 1, account_id: 1, account_name: 'AI科技评论', username: 'gh_abc123', status: 'success', total_count: 20, new_count: 5, matched_count: 3, error_message: '', started_at: '2026-07-09 10:00:00', finished_at: '2026-07-09 10:00:42' },
    { id: 2, account_id: 2, account_name: '出海笔记', username: 'gh_def456', status: 'success', total_count: 20, new_count: 3, matched_count: 2, error_message: '', started_at: '2026-07-09 10:01:00', finished_at: '2026-07-09 10:01:38' },
    { id: 3, account_id: 1, account_name: 'AI科技评论', username: 'gh_abc123', status: 'failed', total_count: 0, new_count: 0, matched_count: 0, error_message: '请求超时', started_at: '2026-07-09 09:00:00', finished_at: '2026-07-09 09:00:45' },
  ];

  private delay(ms: number = 200): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async login(username: string, password: string) {
    await this.delay();
    if (username === 'admin' && password === 'admin123') {
      return { success: true, data: { id: 1, username: 'admin' } };
    }
    return { success: false, message: '用户名或密码错误' };
  }

  async getAccounts() { await this.delay(); return { success: true, data: [...this.mockAccounts] }; }
  async createAccount(data: any) { await this.delay(); this.mockAccounts.unshift({ ...data, id: Date.now(), status: 1, last_crawl_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }); return { success: true }; }
  async updateAccount(id: number, data: any) { await this.delay(); const idx = this.mockAccounts.findIndex(a => a.id === id); if (idx >= 0) Object.assign(this.mockAccounts[idx], data); return { success: true }; }
  async toggleAccount(id: number, status: number) { await this.delay(); const a = this.mockAccounts.find(a => a.id === id); if (a) a.status = status; return { success: true }; }
  async deleteAccount(id: number) { await this.delay(); this.mockAccounts = this.mockAccounts.filter(a => a.id !== id); return { success: true }; }
  async crawlAccount(_id: number) { await this.delay(1000); return { success: true }; }

  async getKeywords() { await this.delay(); return { success: true, data: [...this.mockKeywords] }; }
  async createKeyword(data: any) { await this.delay(); this.mockKeywords.unshift({ ...data, id: Date.now(), status: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }); return { success: true }; }
  async updateKeyword(id: number, data: any) { await this.delay(); const idx = this.mockKeywords.findIndex(k => k.id === id); if (idx >= 0) Object.assign(this.mockKeywords[idx], data); return { success: true }; }
  async toggleKeyword(id: number, status: number) { await this.delay(); const k = this.mockKeywords.find(k => k.id === id); if (k) k.status = status; return { success: true }; }
  async deleteKeyword(id: number) { await this.delay(); this.mockKeywords = this.mockKeywords.filter(k => k.id !== id); return { success: true }; }

  async getArticles(filters: any = {}) {
    await this.delay();
    let list = [...this.mockArticles];
    if (filters.keyword) list = list.filter(a => a.matched_keywords.includes(filters.keyword));
    if (filters.username) list = list.filter(a => a.username === filters.username);
    if (filters.is_read !== undefined && filters.is_read !== null) list = list.filter(a => a.is_read === filters.is_read);
    if (filters.title_search) list = list.filter(a => a.title.includes(filters.title_search));
    const page = filters.page || 1;
    const pageSize = filters.pageSize || 20;
    const start = (page - 1) * pageSize;
    return { success: true, data: { list: list.slice(start, start + pageSize), total: list.length, page, pageSize } };
  }
  async markArticleRead(id: number, isRead: number) { await this.delay(); const a = this.mockArticles.find(a => a.id === id); if (a) a.is_read = isRead; return { success: true }; }

  async getLogs(params: any = {}) { await this.delay(); return { success: true, data: { list: this.mockLogs, total: this.mockLogs.length, page: params.page || 1, pageSize: params.pageSize || 20 } }; }

  async getStats() {
    await this.delay();
    return { success: true, data: { accountCount: 3, activeAccountCount: 2, keywordCount: 3, articleCount: 25, unreadCount: 17, todayArticles: 8 } };
  }

  async getSetting(_key: string) { await this.delay(); return { success: true, data: '' }; }
  async setSetting(_key: string, _value: string) { await this.delay(); return { success: true }; }
  async crawlAll() { await this.delay(1500); return { success: true }; }
}

export function getAPI(): ElectronAPI {
  if (window.electronAPI) {
    return window.electronAPI;
  }
  return new MockAPI();
}
