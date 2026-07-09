'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, Row, Col, Statistic, Button, message, Table, Tag, Space } from 'antd'
import { SyncOutlined, FileTextOutlined, UserOutlined, CheckCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import { useRouter } from 'next/navigation'
import dayjs from 'dayjs'
import { useCachedFetch } from '@/lib/cache'

export default function DashboardPage() {
  const router = useRouter()
  const [crawlLoading, setCrawlLoading] = useState(false)

  const { data: stats, loading, refresh } = useCachedFetch(
    'dashboard-stats',
    async () => {
      const res = await fetch('/api/dashboard')
      const data = await res.json()
      if (data.success) return data.data
      throw new Error(data.message || 'Failed to fetch')
    }
  )

  const { data: logsData, refresh: refreshLogs } = useCachedFetch(
    'dashboard-logs',
    async () => {
      const res = await fetch('/api/crawl-logs?limit=5')
      const data = await res.json()
      if (data.success) return data.data
      return { logs: [] }
    }
  )

  const handleCrawl = useCallback(async () => {
    setCrawlLoading(true)
    try {
      const res = await fetch('/api/crawl', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: '{}' 
      })
      const data = await res.json()
      if (data.success) {
        message.success(`采集完成: 新增 ${data.data.newArticles} 篇, 命中 ${data.data.matchedArticles} 篇`)
        refresh()
        refreshLogs()
      } else {
        message.error(data.message || '采集失败')
      }
    } catch (error: any) {
      message.error(error.message || '采集失败')
    } finally {
      setCrawlLoading(false)
    }
  }, [refresh, refreshLogs])

  const logColumns = [
    { title: '时间', dataIndex: 'started_at', key: 'started_at', width: 160, render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (v: string) => {
      const colors: Record<string, string> = { success: 'green', partial: 'orange', failed: 'red', running: 'blue' }
      return <Tag color={colors[v] || 'default'}>{v}</Tag>
    }},
    { title: '发现', dataIndex: 'articles_found', key: 'articles_found', width: 80 },
    { title: '命中', dataIndex: 'articles_matched', key: 'articles_matched', width: 80 },
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
            <Statistic title="文章总数" value={stats?.articleCount || 0} prefix={<FileTextOutlined />} loading={loading} />
          </Card>
        </Col>
        <Col span={6}>
          <Card hoverable>
            <Statistic title="今日新增" value={stats?.todayArticleCount || 0} prefix={<CheckCircleOutlined />} loading={loading} />
          </Card>
        </Col>
        <Col span={6}>
          <Card hoverable>
            <Statistic title="未读文章" value={stats?.unreadCount || 0} prefix={<FileTextOutlined />} loading={loading} valueStyle={{ color: '#cf1322' }} />
          </Card>
        </Col>
      </Row>

      <Card 
        title="快捷操作" 
        style={{ marginBottom: 24 }}
        extra={<Button icon={<ReloadOutlined />} onClick={() => { refresh(); refreshLogs() }}>刷新</Button>}
      >
        <Space>
          <Button 
            type="primary" 
            icon={<SyncOutlined spin={crawlLoading} />} 
            loading={crawlLoading}
            onClick={handleCrawl}
            size="large"
          >
            立即采集全部
          </Button>
        </Space>
      </Card>

      <Card title="最近采集日志">
        <Table
          dataSource={logsData?.logs || []}
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
