'use client'

import { useState, useCallback, useEffect } from 'react'
import { Table, Tag, Button, Space } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

export default function CrawlLogsPage() {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/crawl-logs?page=${page}&pageSize=${pageSize}`)
      const result = await res.json()
      if (result.success) {
        setData(result.data.list)
        setHasMore(result.data.hasMore)
      } else {
        message.error(result.message || '获取采集日志失败')
      }
    } catch (error: any) {
      message.error(error?.message || '获取采集日志失败')
    }
    finally { setLoading(false) }
  }, [page, pageSize])

  useEffect(() => { fetchData() }, [fetchData])

  const columns = [
    { title: '开始时间', dataIndex: 'started_at', key: 'started_at', width: 160, render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-' },
    { title: '结束时间', dataIndex: 'finished_at', key: 'finished_at', width: 160, render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90, render: (v: string) => {
      const colors: Record<string, string> = { success: 'green', partial: 'orange', failed: 'red', running: 'blue' }
      const labels: Record<string, string> = { success: '成功', partial: '部分成功', failed: '失败', running: '运行中' }
      return <Tag color={colors[v] || 'default'}>{labels[v] || v}</Tag>
    }},
    { title: '采集账号数', dataIndex: 'accounts_crawled', key: 'accounts_crawled', width: 90, align: 'center' as const, render: (v: number) => v ?? 0 },
    { title: '发现文章', dataIndex: 'articles_found', key: 'articles_found', width: 80, align: 'center' as const, render: (v: number) => v ?? 0 },
    { title: '命中文章', dataIndex: 'articles_matched', key: 'articles_matched', width: 80, align: 'center' as const, render: (v: number) => v ?? 0 },
    { title: '新增入库', dataIndex: 'articles_new', key: 'articles_new', width: 80, align: 'center' as const, render: (v: number) => v ?? 0 },
    { title: '错误信息', dataIndex: 'message', key: 'message', ellipsis: true, render: (v: string) => v || '-' },
  ]

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
      </div>
      <Table 
        columns={columns} 
        dataSource={data} 
        rowKey="id" 
        loading={loading}
        size="middle"
        pagination={{ 
          current: page, 
          pageSize, 
          total: hasMore ? page * pageSize + pageSize : data.length + (page - 1) * pageSize,
          showSizeChanger: true,
          showTotal: () => hasMore ? `已加载 ${page * pageSize} 条，继续翻页查看更多` : `共 ${data.length + (page - 1) * pageSize} 条`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps) } 
        }} 
      />
    </div>
  )
}
