import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';

let db: Database.Database;

function getDbPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'wechat-monitor.db');
}

export function initDatabase(): Database.Database {
  db = new Database(getDbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  createTables();
  seedDefaultAdmin();
  return db;
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

function createTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      status INTEGER DEFAULT 1,
      remark TEXT DEFAULT '',
      last_crawl_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      group_name TEXT DEFAULT '',
      status INTEGER DEFAULT 1,
      remark TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      account_name TEXT DEFAULT '',
      username TEXT DEFAULT '',
      publish_time DATETIME,
      original_url TEXT,
      summary TEXT DEFAULT '',
      cover_url TEXT DEFAULT '',
      article_unique_key TEXT DEFAULT '',
      matched_keywords TEXT DEFAULT '',
      is_read INTEGER DEFAULT 0,
      crawled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(original_url),
      UNIQUE(article_unique_key)
    );

    CREATE TABLE IF NOT EXISTS crawl_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      account_name TEXT DEFAULT '',
      username TEXT DEFAULT '',
      status TEXT NOT NULL,
      total_count INTEGER DEFAULT 0,
      new_count INTEGER DEFAULT 0,
      matched_count INTEGER DEFAULT 0,
      error_message TEXT DEFAULT '',
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_articles_publish_time ON articles(publish_time DESC);
    CREATE INDEX IF NOT EXISTS idx_articles_username ON articles(username);
    CREATE INDEX IF NOT EXISTS idx_articles_is_read ON articles(is_read);
    CREATE INDEX IF NOT EXISTS idx_crawl_logs_account_id ON crawl_logs(account_id);
  `);
}

function seedDefaultAdmin(): void {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!existing) {
    db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run('admin', 'admin123');
  }
}
