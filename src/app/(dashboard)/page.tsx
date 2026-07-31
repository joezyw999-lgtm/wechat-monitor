'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Card, Row, Col, Statistic, Button, message, Table, Tag, Space, Modal, Select, Progress } from 'antd'
import { SyncOutlined, WalletOutlined, UserOutlined, CheckCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useCachedFetch } from '@/lib/cache'

export default function DashboardPage() {
  const [crawlLoading, setCrawlLoading] = useState(false)
  const [crawlModalOpen, setCrawlModalOpen] = useState(false)
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([])
  const [keywordsList, setKeywordsList] = useState<string[]>([])
  const [keywordsLoading, setKeywordsLoading] = useState(false)

  // 采集进度状态
  const [crawlProgress, setCrawlProgress] = useState<{
    status: string
    cursor_position: number
    total_accounts: number
    articles_new: number
    articles_found: number
    log_id: string | null
  } | null>(null)
  const [isCrawling, setIsCrawling] = useState(false)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isAutoContinuingRef = useRef(false)

  const fetchStats = useCallback(async () => {
    const res = await fetch('/api/dashboard')
    const data = await res.json()
    if (data.success) return data.data
    throw new Error(data.message || 'Failed to fetch')
  }, [])

  const { data: stats, loading, refresh } = useCachedFetch('dashboard-stats', fetchStats)

  // 获取最新采集状态
  const fetchCrawlStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/crawl')
      const data = await res.json()
      if (data.success && data.data) {
        return data.data
      }
      return null
    } catch {
      return null
    }
  }, [])

  // 轮询检查采集状态
  const startPolling = useCallback(() => {
    const poll = async () => {
      const status = await fetchCrawlStatus()
      if (!status || !status.current) {
        setIsCrawling(false)
        setCrawlProgress(null)
        return
      }

      const current = status.current
      setCrawlProgress({
        status: current.status,
        cursor_position: current.cursor_position || 0,
        total_accounts: current.total_accounts || 0,
        articles_new: current.articles_new || 0,
        articles_found: current.articles_found || 0,
        log_id: current.id,
      })

      // 如果正在运行，继续轮询
      if (current.status === 'running') {
        setIsCrawling(true)
        pollTimerRef.current = setTimeout(poll, 4000)
        return
      }

      // 如果是 partial 且还有未完成的，自动续跑
      if (current.status === 'partial' && status.has_more && isAutoContinuingRef.current) {
        console.log('[Crawl] Auto-continuing from partial state')
        setIsCrawling(true)
        try {
          const res = await fetch('/api/crawl', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resume: true }),
          })
          const data = await res.json()
          if (data.success) {
            // 续跑成功，继续轮询
            pollTimerRef.current = setTimeout(poll, 4000)
            return
          } else if (res.status === 409) {
            // 冲突，已有任务在运行，继续轮询
            pollTimerRef.current = setTimeout(poll, 4000)
            return
          }
        } catch {
          // 续跑失败，停止
        }
        setIsCrawling(false)
        isAutoContinuingRef.current = false
        return
      }

      // 完成或失败，停止轮询
      setIsCrawling(false)
      isAutoContinuingRef.current = false
      refresh()
    }

    poll()
  }, [fetchCrawlStatus, refresh])

  // 清理轮询
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

  // 页面加载时检查是否有运行中的任务
  useEffect(() => {
    const checkRunning = async () => {
      const status = await fetchCrawlStatus()
      if (status?.has_running) {
        setIsCrawling(true)
        isAutoContinuingRef.current = true
        startPolling()
      }
    }
    checkRunning()
  }, [fetchCrawlStatus, startPolling])

  // Load keywords list when modal opens
  const loadKeywords = useCallback(async () => {
    setKeywordsLoading(true)
    try {
      const res = await fetch('/api/keywords')
      const data = await res.json()
      if (data.success) {
        const words = (data.data.list || data.data || []).map((k: any) => k.word || k.keyword || k.name).filter(Boolean)
        setKeywordsList(words)
      }
    } catch (e: any) {
      message.error(e.message || '加载关键词失败')
    } finally {
      setKeywordsLoading(false)
    }
  }, [])

  const handleOpenCrawl = useCallback(() => {
    setSelectedKeywords([])
    setCrawlModalOpen(true)
    loadKeywords()
  }, [loadKeywords])

  const handleCrawl = useCallback(async () => {
    setCrawlLoading(true)
    setCrawlModalOpen(false)
    setIsCrawling(true)
    isAutoContinuingRef.current = true
    try {
      const res = await fetch('/api/crawl', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ keywords: selectedKeywords })
      })
      const data = await res.json()
      if (data.success) {
        message.success(`采集任务已启动，正在处理 ${data.data.total_accounts} 个公众号...`)
        // 启动轮询
        startPolling()
      } else if (res.status === 409) {
        message.warning(data.message || '已有采集任务正在运行')
        // 已有任务运行，也启动轮询显示进度
        startPolling()
      } else {
        message.error(data.message || '采集失败')
        setIsCrawling(false)
        isAutoContinuingRef.current = false
      }
    } catch (error: any) {
      message.error(error.message || '采集失败')
      setIsCrawling(false)
      isAutoContinuingRef.current = false
    } finally {
      setCrawlLoading(false)
    }
  }, [selectedKeywords, startPolling])

  const logColumns = [
    { title: '时间', dataIndex: 'started_at', key: 'started_at', width: 140, render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, render: (v: string) => {
      const colors: Record<string, string> = { success: 'green', partial: 'orange', failed: 'red', running: 'blue', timeout: 'purple' }
      const labels: Record<string, string> = { success: '完成', partial: '部分完成', failed: '失败', running: '进行中', timeout: '超时' }
      return <Tag color={colors[v] || 'default'}>{labels[v] || v}</Tag>
    }},
    { title: '采集账号', dataIndex: 'accounts_crawled', key: 'accounts_crawled', width: 80, align: 'center' as const,
      render: (v: number, record: any) => {
        const total = record.total_accounts
        return total ? `${v ?? 0}/${total}` : (v ?? 0)
      }
    },
    { title: '发现', dataIndex: 'articles_found', key: 'articles_found', width: 60, align: 'center' as const, render: (v: number) => v ?? 0 },
    { title: '命中', dataIndex: 'articles_matched', key: 'articles_matched', width: 60, align: 'center' as const, render: (v: number) => v ?? 0 },
    { title: '新增', dataIndex: 'articles_new', key: 'articles_new', width: 60, align: 'center' as const, render: (v: number) => v ?? 0 },
  ]

  const progressPercent = useMemo(() => {
    if (!crawlProgress || !crawlProgress.total_accounts) return 0
    return Math.round((crawlProgress.cursor_position / crawlProgress.total_accounts) * 100)
  }, [crawlProgress])

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card hoverable>
            <Statistic title="监控公众号" value={stats?.accountCount || 0} prefix={<UserOutlined />} loading={loading} />
          </Card>
        </Col>
        <Col span={6}>
          <Card hoverable>
            <Statistic title="今日新增" value={stats?.todayArticleCount || 0} prefix={<CheckCircleOutlined />} loading={loading} />
          </Card>
        </Col>
        <Col span={6}>
          <Card hoverable>
            <Statistic title="未读文章" value={stats?.unreadCount || 0} prefix={<CheckCircleOutlined />} loading={loading} styles={{ content: { color: '#cf1322' } }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card hoverable>
            <Statistic 
              title="账户余额" 
              value={stats?.balance != null ? stats.balance : null} 
              prefix="¥" 
              loading={loading} 
              valueStyle={{ color: '#3f8600' }}
              formatter={(value: any) => value != null ? value.toFixed(2) : '—'}
            />
          </Card>
        </Col>
      </Row>

      <Card 
        title="快捷操作" 
        style={{ marginBottom: 24 }}
        extra={<Button icon={<ReloadOutlined />} onClick={() => refresh()}>刷新</Button>}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space>
            <Button 
              type="primary" 
              icon={<SyncOutlined spin={isCrawling} />} 
              loading={isCrawling || crawlLoading}
              onClick={handleOpenCrawl}
              size="large"
              disabled={isCrawling}
            >
              {isCrawling ? '采集中...' : '立即采集'}
            </Button>
          </Space>

          {/* 采集进度条 */}
          {isCrawling && crawlProgress && (
            <Card size="small" style={{ background: '#f6ffed', borderColor: '#b7eb8f' }}>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>
                采集中：{crawlProgress.cursor_position} / {crawlProgress.total_accounts} 个公众号
                <span style={{ float: 'right', color: '#52c41a' }}>{progressPercent}%</span>
              </div>
              <Progress percent={progressPercent} status="active" size="small" />
              <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
                已发现 {crawlProgress.articles_found} 篇文章，新增 {crawlProgress.articles_new} 篇
                <span style={{ marginLeft: 16 }}>系统将自动分批完成全部采集</span>
              </div>
            </Card>
          )}
        </Space>
      </Card>

      <Modal
        title="开始采集"
        open={crawlModalOpen}
        onOk={handleCrawl}
        onCancel={() => setCrawlModalOpen(false)}
        okText="开始采集"
        cancelText="取消"
        confirmLoading={crawlLoading}
        width={480}
      >
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8, color: '#666' }}>
            选择要采集的关键词范围：
          </div>
          <Select
            mode="multiple"
            placeholder="不选则使用全部启用关键词"
            value={selectedKeywords}
            onChange={setSelectedKeywords}
            loading={keywordsLoading}
            style={{ width: '100%' }}
            options={keywordsList.map(w => ({ label: w, value: w }))}
            maxTagCount="responsive"
            allowClear
            showSearch
            filterOption={(input, option) =>
              (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())
            }
          />
        </div>
        <div style={{ fontSize: 12, color: '#999' }}>
          {selectedKeywords.length > 0
            ? `已选择 ${selectedKeywords.length} 个关键词，本次只采集匹配这些关键词的文章`
            : '未选择关键词，将使用系统中全部启用的关键词'}
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: '#1890ff', background: '#e6f7ff', padding: '8px 12px', borderRadius: 4 }}>
          系统将自动分批完成全部采集，无需手动续跑
        </div>
      </Modal>

      <Card title="最近采集日志">
        <Table
          dataSource={stats?.recentLogs || []}
          columns={logColumns}
          rowKey="id"
          pagination={false}
          size="small"
          loading={loading}
        />
      </Card>
    </div>
  )
}
