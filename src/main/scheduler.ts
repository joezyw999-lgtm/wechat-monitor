import cron from 'node-cron';
import { crawlAllAccounts, crawlAccount } from './api';
import { getDatabase } from './database';

let scheduledTask: cron.ScheduledTask | null = null;

export function startScheduler(): void {
  const db = getDatabase();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('cron_expression') as { value: string } | undefined;
  const cronExpr = row?.value || '0 * * * *';

  if (scheduledTask) {
    scheduledTask.stop();
  }

  scheduledTask = cron.schedule(cronExpr, async () => {
    console.log(`[${new Date().toISOString()}] 定时采集任务开始`);
    try {
      const results = await crawlAllAccounts();
      let totalNew = 0;
      let totalMatched = 0;
      results.forEach((r) => {
        totalNew += r.newCount;
        totalMatched += r.matchedCount;
      });
      console.log(`[${new Date().toISOString()}] 定时采集完成: 新增 ${totalNew} 篇, 命中 ${totalMatched} 篇`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] 定时采集异常:`, error);
    }
  });

  console.log(`定时采集任务已启动, cron: ${cronExpr}`);
}

export function stopScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
}

export function restartScheduler(): void {
  stopScheduler();
  startScheduler();
}

export async function triggerManualCrawl(accountId?: number): Promise<void> {
  if (accountId) {
    const db = getDatabase();
    const account = db.prepare('SELECT id, name, username FROM accounts WHERE id = ?').get(accountId) as {
      id: number;
      name: string;
      username: string;
    } | undefined;

    if (!account) {
      throw new Error('公众号不存在');
    }

    await crawlAccount(account.id, account.name, account.username);
  } else {
    await crawlAllAccounts();
  }
}
