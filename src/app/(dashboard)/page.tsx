'use client'

import { useState, useEffect } from 'react'
import { Card, Row, Col, Statistic, Button, message, Table, Tag } from 'antd'
import { SyncOutlined, FileTextOutlined, UserOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { useRouter } from 'next/navigation'
import dayjs from 'dayjs'

export default function DashboardPage() {
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [crawlLoading, setCrawlLoading] = useState(false)
  const router = useRouter()

  const fetchStats = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/dashboard')
      const data = await res.json()
      if (data.success) setStats(data.data)
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchStats() }, [])

  const handleCrawl = async () => {
    setCrawlLoading(true)
    try {
      const res = await fetch('/api/crawl', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = await res.json()
      if (data.success) {
        message.success(`采集完成: 新增 ${data.data.newArticles} 篇, 命中 ${data.data.matchedArticles} 篇`)
        fetchStats()
      } else {
        message.error(data.message || '采集失败')
      }
    } catch (error: any) {
      message.error(error.message || '采集失败')
    } finally {
      setCrawlLoading(false)
    }
  }

  const logColumns = [
    { title: '时间', dataIndex: 'started_at', key: 'started_at', render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => {
      const colors: Record<string, string> = { success: 'green', partial: 'orange', failed: 'red', running: 'blue' }
      return <Tag color={colors[v] || 'default'}>{v}</Tag>
    }},
  ]

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic title="监控公众号" value={stats?.accountCount || 0} prefix={<UserOutlined />} loading={loading} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="文章总数" value={stats?.articleCount || 0} prefix={<FileTextOutlined />} loading={loading} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="今日新增" value={stats?.todayArticleCount || 0} prefix={<CheckCircleOutlined />} loading={loading} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="未读文章" value={stats?.unreadCount || 0} prefix={<FileTextOutlined />} loading={loading} valueStyle={{ color: '#cf1322' }} />
          </Card>
        </Col>
      </Row>

      <Card title="快捷操作" style={{ marginBottom: 24 }}>
        <Button type="primary" icon={<SyncOutlined />} loading={crawlLoading} onClick={handleCrawl} size="large">
          立即采集全部
        </Button>
      </Card>

      <Card title="最近采集记录">
        <Table columns={logColumns} dataSource={stats?.recentLogs || []} rowKey="id" pagination={false} size="small" />
      </Card>
    </div>
  )
}
