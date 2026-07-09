import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // Auth
  login: (username: string, password: string) => ipcRenderer.invoke('auth:login', username, password),

  // Accounts
  getAccounts: () => ipcRenderer.invoke('accounts:list'),
  createAccount: (data: { name: string; username: string; remark?: string }) => ipcRenderer.invoke('accounts:create', data),
  updateAccount: (id: number, data: { name?: string; remark?: string }) => ipcRenderer.invoke('accounts:update', id, data),
  toggleAccount: (id: number, status: number) => ipcRenderer.invoke('accounts:toggle', id, status),
  deleteAccount: (id: number) => ipcRenderer.invoke('accounts:delete', id),
  crawlAccount: (id: number) => ipcRenderer.invoke('accounts:crawl', id),

  // Keywords
  getKeywords: () => ipcRenderer.invoke('keywords:list'),
  createKeyword: (data: { keyword: string; group_name?: string; remark?: string }) => ipcRenderer.invoke('keywords:create', data),
  updateKeyword: (id: number, data: { keyword?: string; group_name?: string; remark?: string }) => ipcRenderer.invoke('keywords:update', id, data),
  toggleKeyword: (id: number, status: number) => ipcRenderer.invoke('keywords:toggle', id, status),
  deleteKeyword: (id: number) => ipcRenderer.invoke('keywords:delete', id),

  // Articles
  getArticles: (filters: any) => ipcRenderer.invoke('articles:list', filters),
  markArticleRead: (id: number, isRead: number) => ipcRenderer.invoke('articles:markRead', id, isRead),

  // Logs
  getLogs: (params: { page?: number; pageSize?: number }) => ipcRenderer.invoke('logs:list', params),

  // Dashboard
  getStats: () => ipcRenderer.invoke('dashboard:stats'),

  // Settings
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),

  // Crawl
  crawlAll: () => ipcRenderer.invoke('crawl:all'),
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
