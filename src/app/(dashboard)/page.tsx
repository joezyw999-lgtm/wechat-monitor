'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Card, Row, Col, Statistic, Button, message, Table, Tag, Space, Modal, Select } from 'antd'
import { SyncOutlined, WalletOutlined, UserOutlined, CheckCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useCachedFetch } from '@/lib/cache'

export default function DashboardPage() {
  const [crawlLoading, setCrawlLoading] = useState(false)
  const [crawlModalOpen, setCrawlModalOpen] = useState(false)
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([])
  const [keywordsList, setKeywordsList] = useState<string[]>([])
  const [keywordsLoading, setKeywordsLoading] = useState(false)

  const fetchStats = useCallback(async () => {
    const res = await fetch('/api/dashboard')
    const data = await res.json()
    if (data.success) return data.data
    throw new Error(data.message || 'Failed to fetch')
  }, [])

  const { data: stats, loading, refresh } = useCachedFetch('dashboard-stats', fetchStats)

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
    try {
      const res = await fetch('/api/crawl', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ keywords: selectedKeywords })
      })
      const data = await res.json()
      if (data.success) {
        const kwDesc = selectedKeywords.length > 0 ? ` (${selectedKeywords.length} 个关键词)` : ' (全部关键词)'
        message.success(`采集完成${kwDesc}: 新增 ${data.data.articles_new} 篇, 命中 ${data.data.articles_matched} 篇`)
        refresh()
      } else {
        message.error(data.message || '采集失败')
      }
    } catch (error: any) {
      message.error(error.message || '采集失败')
    } finally {
      setCrawlLoading(false)
    }
  }, [refresh, selectedKeywords])

  const logColumns = [
    { title: '时间', dataIndex: 'started_at', key: 'started_at', width: 140, render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, render: (v: string) => {
      const colors: Record<string, string> = { success: 'green', partial: 'orange', failed: 'red', running: 'blue' }
      return <Tag color={colors[v] || 'default'}>{v}</Tag>
    }},
    { title: '采集账号', dataIndex: 'accounts_crawled', key: 'accounts_crawled', width: 70, align: 'center' as const, render: (v: number) => v ?? 0 },
    { title: '发现', dataIndex: 'articles_found', key: 'articles_found', width: 60, align: 'center' as const, render: (v: number) => v ?? 0 },
    { title: '命中', dataIndex: 'articles_matched', key: 'articles_matched', width: 60, align: 'center' as const, render: (v: number) => v ?? 0 },
    { title: '新增', dataIndex: 'articles_new', key: 'articles_new', width: 60, align: 'center' as const, render: (v: number) => v ?? 0 },
  ]

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
        <Space>
          <Button 
            type="primary" 
            icon={<SyncOutlined spin={crawlLoading} />} 
            loading={crawlLoading}
            onClick={handleOpenCrawl}
            size="large"
          >
            立即采集
          </Button>
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
