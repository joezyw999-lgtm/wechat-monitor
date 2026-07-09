import { ipcMain, BrowserWindow } from 'electron';
import { getDatabase } from './database';
import { restartScheduler, triggerManualCrawl } from './scheduler';

export function registerIpcHandlers(): void {
  // ========== Auth ==========
  ipcMain.handle('auth:login', (_event, username: string, password: string) => {
    const db = getDatabase();
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?').get(username, password) as any;
    if (user) {
      return { success: true, data: { id: user.id, username: user.username } };
    }
    return { success: false, message: '用户名或密码错误' };
  });

  // ========== Accounts ==========
  ipcMain.handle('accounts:list', () => {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM accounts ORDER BY created_at DESC').all();
    return { success: true, data: rows };
  });

  ipcMain.handle('accounts:create', (_event, data: { name: string; username: string; remark?: string }) => {
    const db = getDatabase();
    if (!data.name || !data.username) {
      return { success: false, message: '公众号名称和原始ID不能为空' };
    }
    if (!data.username.startsWith('gh_')) {
      return { success: false, message: '公众号原始ID必须以 gh_ 开头' };
    }
    try {
      const result = db.prepare('INSERT INTO accounts (name, username, remark) VALUES (?, ?, ?)').run(
        data.name, data.username, data.remark || ''
      );
      return { success: true, data: { id: result.lastInsertRowid } };
    } catch (error: any) {
      if (error.message?.includes('UNIQUE')) {
        return { success: false, message: '该公众号原始ID已存在' };
      }
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('accounts:update', (_event, id: number, data: { name?: string; remark?: string }) => {
    const db = getDatabase();
    db.prepare('UPDATE accounts SET name = COALESCE(?, name), remark = COALESCE(?, remark), updated_at = ? WHERE id = ?')
      .run(data.name || null, data.remark || null, new Date().toISOString(), id);
    return { success: true };
  });

  ipcMain.handle('accounts:toggle', (_event, id: number, status: number) => {
    const db = getDatabase();
    db.prepare('UPDATE accounts SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), id);
    return { success: true };
  });

  ipcMain.handle('accounts:delete', (_event, id: number) => {
    const db = getDatabase();
    db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
    return { success: true };
  });

  ipcMain.handle('accounts:crawl', async (_event, id: number) => {
    try {
      await triggerManualCrawl(id);
      return { success: true };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  });

  // ========== Keywords ==========
  ipcMain.handle('keywords:list', () => {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM keywords ORDER BY created_at DESC').all();
    return { success: true, data: rows };
  });

  ipcMain.handle('keywords:create', (_event, data: { keyword: string; group_name?: string; remark?: string }) => {
    const db = getDatabase();
    if (!data.keyword) {
      return { success: false, message: '关键词不能为空' };
    }
    try {
      const result = db.prepare('INSERT INTO keywords (keyword, group_name, remark) VALUES (?, ?, ?)').run(
        data.keyword, data.group_name || '', data.remark || ''
      );
      return { success: true, data: { id: result.lastInsertRowid } };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('keywords:update', (_event, id: number, data: { keyword?: string; group_name?: string; remark?: string }) => {
    const db = getDatabase();
    db.prepare('UPDATE keywords SET keyword = COALESCE(?, keyword), group_name = COALESCE(?, group_name), remark = COALESCE(?, remark), updated_at = ? WHERE id = ?')
      .run(data.keyword || null, data.group_name || null, data.remark || null, new Date().toISOString(), id);
    return { success: true };
  });

  ipcMain.handle('keywords:toggle', (_event, id: number, status: number) => {
    const db = getDatabase();
    db.prepare('UPDATE keywords SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), id);
    return { success: true };
  });

  ipcMain.handle('keywords:delete', (_event, id: number) => {
    const db = getDatabase();
    db.prepare('DELETE FROM keywords WHERE id = ?').run(id);
    return { success: true };
  });

  // ========== Articles ==========
  ipcMain.handle('articles:list', (_event, filters: {
    keyword?: string;
    username?: string;
    start_time?: string;
    end_time?: string;
    is_read?: number;
    title_search?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const db = getDatabase();
    const conditions: string[] = ["matched_keywords != ''"];
    const params: any[] = [];

    if (filters.keyword) {
      conditions.push("matched_keywords LIKE ?");
      params.push(`%${filters.keyword}%`);
    }
    if (filters.username) {
      conditions.push("username = ?");
      params.push(filters.username);
    }
    if (filters.start_time) {
      conditions.push("publish_time >= ?");
      params.push(filters.start_time);
    }
    if (filters.end_time) {
      conditions.push("publish_time <= ?");
      params.push(filters.end_time);
    }
    if (filters.is_read !== undefined && filters.is_read !== null) {
      conditions.push("is_read = ?");
      params.push(filters.is_read);
    }
    if (filters.title_search) {
      conditions.push("title LIKE ?");
      params.push(`%${filters.title_search}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const page = filters.page || 1;
    const pageSize = filters.pageSize || 20;
    const offset = (page - 1) * pageSize;

    const countRow = db.prepare(`SELECT COUNT(*) as total FROM articles ${whereClause}`).get(...params) as { total: number };
    const rows = db.prepare(`SELECT * FROM articles ${whereClause} ORDER BY COALESCE(publish_time, crawled_at) DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, offset);

    return { success: true, data: { list: rows, total: countRow.total, page, pageSize } };
  });

  ipcMain.handle('articles:markRead', (_event, id: number, isRead: number) => {
    const db = getDatabase();
    db.prepare('UPDATE articles SET is_read = ? WHERE id = ?').run(isRead, id);
    return { success: true };
  });

  // ========== Crawl Logs ==========
  ipcMain.handle('logs:list', (_event, params: { page?: number; pageSize?: number }) => {
    const db = getDatabase();
    const page = params.page || 1;
    const pageSize = params.pageSize || 20;
    const offset = (page - 1) * pageSize;

    const countRow = db.prepare('SELECT COUNT(*) as total FROM crawl_logs').get() as { total: number };
    const rows = db.prepare('SELECT * FROM crawl_logs ORDER BY started_at DESC LIMIT ? OFFSET ?')
      .all(pageSize, offset);

    return { success: true, data: { list: rows, total: countRow.total, page, pageSize } };
  });

  // ========== Dashboard ==========
  ipcMain.handle('dashboard:stats', () => {
    const db = getDatabase();
    const accountCount = (db.prepare('SELECT COUNT(*) as count FROM accounts').get() as any).count;
    const activeAccountCount = (db.prepare('SELECT COUNT(*) as count FROM accounts WHERE status = 1').get() as any).count;
    const keywordCount = (db.prepare('SELECT COUNT(*) as count FROM keywords').get() as any).count;
    const articleCount = (db.prepare("SELECT COUNT(*) as count FROM articles WHERE matched_keywords != ''").get() as any).count;
    const unreadCount = (db.prepare("SELECT COUNT(*) as count FROM articles WHERE matched_keywords != '' AND is_read = 0").get() as any).count;
    const todayArticles = (db.prepare("SELECT COUNT(*) as count FROM articles WHERE matched_keywords != '' AND date(crawled_at) = date('now')").get() as any).count;

    return {
      success: true,
      data: { accountCount, activeAccountCount, keywordCount, articleCount, unreadCount, todayArticles }
    };
  });

  // ========== Settings ==========
  ipcMain.handle('settings:get', (_event, key: string) => {
    const db = getDatabase();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return { success: true, data: row?.value || '' };
  });

  ipcMain.handle('settings:set', (_event, key: string, value: string) => {
    const db = getDatabase();
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
    if (key === 'cron_expression') {
      restartScheduler();
    }
    return { success: true };
  });

  // ========== Crawl All ==========
  ipcMain.handle('crawl:all', async () => {
    try {
      await triggerManualCrawl();
      return { success: true };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  });
}
