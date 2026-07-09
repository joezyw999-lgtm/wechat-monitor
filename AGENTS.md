# AGENTS.md - 公众号推文监控系统

## 项目概览

Electron 桌面应用，用于监控微信公众号推文，根据关键词筛选文章并展示。

## 技术栈

- **桌面框架**: Electron 33
- **前端**: React 18 + TypeScript + Ant Design 5 + React Router 6
- **构建工具**: Vite 6 (renderer) + TypeScript (main process)
- **数据库**: better-sqlite3 (本地 SQLite)
- **定时任务**: node-cron
- **HTTP 客户端**: axios
- **打包工具**: electron-builder

## 目录结构

```
src/
├── main/              # Electron 主进程
│   ├── index.ts       # 入口，创建窗口
│   ├── database.ts    # SQLite 数据库初始化与表结构
│   ├── api.ts         # 第三方 API 对接 (getoneapi.com)
│   ├── scheduler.ts   # 定时采集任务
│   └── ipc.ts         # IPC 通信处理器
├── preload/
│   └── index.ts       # 预加载脚本，暴露 API 给渲染进程
└── renderer/
    ├── index.html     # HTML 入口
    └── src/
        ├── main.tsx   # React 入口
        ├── App.tsx    # 路由与认证
        ├── index.css  # 全局样式
        ├── services/
        │   └── api.ts # API 服务层 (含浏览器 Mock)
        ├── components/
        │   └── Layout.tsx  # 侧边栏布局
        └── pages/
            ├── Login.tsx      # 登录页
            ├── Dashboard.tsx  # 仪表盘
            ├── Accounts.tsx   # 公众号管理
            ├── Keywords.tsx   # 关键词管理
            ├── Articles.tsx   # 文章列表
            ├── CrawlLogs.tsx  # 采集日志
            └── Settings.tsx   # 系统设置
```

## 开发命令

```bash
# 安装依赖
pnpm install --ignore-scripts

# 前端开发预览 (浏览器)
pnpm dev

# 编译主进程
pnpm build:main

# 编译前端
pnpm build:renderer

# 打包 Windows EXE
pnpm package:win
```

## 数据库表

| 表名 | 说明 |
|------|------|
| users | 登录用户 |
| accounts | 监控的公众号 |
| keywords | 筛选关键词 |
| articles | 采集的文章 |
| crawl_logs | 采集日志 |
| settings | 系统配置 (api_key, cron_expression) |

## 默认账号

- 用户名: `admin`
- 密码: `admin123`

## 打包 EXE

在 Windows 环境下执行：
```bash
pnpm install
pnpm package:win
```
生成的 EXE 在 `release/` 目录下。
