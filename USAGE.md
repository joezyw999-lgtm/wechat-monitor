# 公众号推文监控系统 - 使用文档

## 系统简介

本系统用于自动监控微信公众号推文，根据关键词过滤并展示匹配的文章。支持多公众号管理、关键词分组、定时采集、已读/未读标记等功能。

### 技术架构

- **前端**：Next.js 16 + React 18 + Ant Design 5
- **后端**：Next.js API Routes (Serverless)
- **数据库**：Supabase (PostgreSQL, 海外节点)
- **定时任务**：Vercel Cron (每天一次)
- **采集接口**：getoneapi.com

---

## 部署步骤

### 1. 准备 Supabase 数据库

1. 打开 https://supabase.com ，用 GitHub 登录
2. 点击 **「New Project」** 创建项目
   - **Name**：`wechat-monitor`（或其他名称）
   - **Database Password**：设置一个密码（记下来）
   - **Region**：选择 **US East (N. Virginia)**（离 Vercel 近）
3. 等待项目创建完成

### 2. 获取 Supabase 连接信息

进入 Supabase 项目 → 左下角 **「Project Settings」** → **「API」**：

- **Project URL** → 复制，这是 `SUPABASE_URL`
- **anon public** Key → 复制，这是 `SUPABASE_ANON_KEY`
- **service_role** Key → 复制，这是 `SUPABASE_SERVICE_KEY`

### 3. 在 Supabase 建表

进入 Supabase 项目 → 左侧 **「SQL Editor」** → **「New Query」**，粘贴以下 SQL 并执行：

```sql
-- 删除旧表重建
DROP TABLE IF EXISTS crawl_logs;
DROP TABLE IF EXISTS articles;
DROP TABLE IF EXISTS keywords;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS users;

-- 用户表
CREATE TABLE users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 公众号表
CREATE TABLE accounts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  wx_id TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'active',
  last_crawled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 关键词表
CREATE TABLE keywords (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  word TEXT NOT NULL,
  group_name TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 文章表
CREATE TABLE articles (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  account_id TEXT REFERENCES accounts(id),
  title TEXT NOT NULL,
  summary TEXT,
  content TEXT,
  original_url TEXT,
  unique_key TEXT,
  published_at TIMESTAMPTZ,
  matched_keywords TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 采集日志表
CREATE TABLE crawl_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  account_id TEXT REFERENCES accounts(id),
  status TEXT NOT NULL,
  message TEXT,
  articles_found INTEGER DEFAULT 0,
  articles_matched INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ
);

-- 系统设置表
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 启用 RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- 插入默认管理员
INSERT INTO users (username, password_hash, status) VALUES ('admin', 'admin123', 'active');
```

### 4. 部署到 Vercel

1. 将代码推送到 GitHub 仓库
2. 打开 https://vercel.com/new ，导入仓库
3. 在 Vercel 项目 **Settings → Environment Variables** 中添加：

| Key | Value |
|-----|-------|
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_ANON_KEY` | Supabase anon Key |
| `SUPABASE_SERVICE_KEY` | Supabase service_role Key |

4. 点击 **「Deploy」** 部署

### 5. 配置 OneAPI Key

1. 访问部署后的网站
2. 使用 `admin` / `admin123` 登录
3. 进入 **「系统设置」** 页面
4. 填入你的 OneAPI Key（从 https://getoneapi.com 注册获取）
5. 点击 **「保存设置」**

---

## 功能说明

### 仪表盘

- 查看系统概览：公众号数量、关键词数量、文章总数、今日新增
- 查看最近采集日志
- 点击 **「立即采集全部」** 手动触发所有公众号的采集

### 公众号管理

添加需要监控的微信公众号：

1. 点击 **「添加公众号」**
2. 填写：
   - **名称**：公众号显示名称（如"观察者网"）
   - **原始ID**：公众号的原始ID，格式为 `gh_xxxxxxxx`
3. 点击 **「确定」** 保存

**如何获取公众号原始ID？**

1. 打开 https://weixin.sogou.com
2. 搜索公众号名称
3. 点进公众号页面，查看浏览器地址栏
4. URL 中的 `__biz=` 后面的内容是 base64 编码的原始ID
5. 或者在搜狗微信搜索的文章页面，右键查看源代码，搜索 `var biz` 或 `biz =`

**操作说明：**
- **启用/停用**：点击状态切换按钮，停用的公众号不会被采集
- **编辑**：修改公众号名称或原始ID
- **删除**：删除公众号及其相关文章
- **立即采集**：手动触发该公众号的采集

### 关键词管理

添加需要监控的关键词：

1. 点击 **「添加关键词」**
2. 填写：
   - **关键词**：要匹配的关键词（如"AI"、"大模型"）
   - **分组**（可选）：关键词分组名称，方便管理
3. 点击 **「确定」** 保存

**匹配规则：**
- 文章的标题或摘要中包含任意一个启用的关键词即视为匹配
- 匹配结果会记录在文章的「匹配关键词」字段

### 文章列表

查看采集到的文章：

- **筛选条件**：
  - 公众号：按公众号筛选
  - 关键词：按匹配关键词筛选
  - 状态：全部/未读/已读
  - 时间范围：按发布时间筛选
- **操作**：
  - 点击文章标题跳转到微信原文
  - 点击「已读/未读」切换阅读状态
  - 支持分页浏览

### 采集日志

查看每次采集的详细记录：

- 采集时间
- 公众号名称
- 采集状态（成功/失败）
- 发现文章数
- 匹配文章数
- 错误信息（如有）

### 系统设置

- **OneAPI Key**：采集接口的 API Key，从 https://getoneapi.com 获取
- **Cron 表达式**：定时采集的时间设置（默认每天 UTC 8:00，即北京时间 16:00）

---

## 定时采集

系统使用 Vercel Cron 进行定时采集，默认配置为每天一次（UTC 8:00）。

**修改采集频率：**

编辑项目根目录的 `vercel.json` 文件：

```json
{
  "crons": [
    {
      "path": "/api/cron/crawl",
      "schedule": "0 8 * * *"
    }
  ]
}
```

常用 Cron 表达式：
- `0 8 * * *` - 每天 UTC 8:00（北京时间 16:00）
- `0 0 * * *` - 每天 UTC 0:00（北京时间 8:00）

**注意**：Vercel 免费版（Hobby）只支持每天一次的定时任务。

---

## 常见问题

### 1. 登录提示"用户名或密码错误"

- 检查 Supabase 环境变量是否配置正确
- 检查 `users` 表是否有 admin 用户
- 执行以下 SQL 重置密码：
  ```sql
  UPDATE users SET password_hash = 'admin123' WHERE username = 'admin';
  ```

### 2. 采集失败，提示 API Key 无效

- 检查「系统设置」中的 OneAPI Key 是否正确
- 登录 https://getoneapi.com 确认账户余额
- 检查 Key 是否已过期

### 3. 采集超时

- getoneapi.com 接口响应较慢，建议超时设置为 60 秒
- 如果频繁超时，可能是网络问题或接口不稳定

### 4. 文章列表为空

- 检查是否已添加公众号并启用
- 检查是否已添加关键词并启用
- 点击「立即采集全部」手动触发采集
- 查看「采集日志」确认采集是否成功

### 5. Vercel 部署失败

- 检查 GitHub 仓库是否已正确关联
- 检查环境变量是否配置完整
- 查看 Vercel 部署日志定位具体错误

---

## 注意事项

1. **API 费用**：getoneapi.com 是付费服务，请根据使用量充值
2. **采集频率**：不要设置过于频繁的采集，避免被封禁
3. **数据备份**：定期备份 Supabase 数据库
4. **隐私合规**：仅用于个人学习研究，遵守相关法律法规

---

## 技术支持

如有问题，请检查：
1. Vercel 部署日志
2. Supabase 数据库状态
3. getoneapi.com 账户状态

---

*文档版本：v1.0*
*更新日期：2026-07-09*
