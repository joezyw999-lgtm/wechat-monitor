'use client'

import { useState, useEffect } from 'react'
import { Table, Tag } from 'antd'
import dayjs from 'dayjs'

export default function CrawlLogsPage() {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/crawl-logs?page=${page}&pageSize=${pageSize}`)
      const result = await res.json()
      if (result.success) {
        setData(result.data.list)
        setTotal(result.data.total)
      }
    } catch (error) { console.error(error) }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchData() }, [page, pageSize])

  const columns = [
    { title: '开始时间', dataIndex: 'started_at', key: 'started_at', render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss') },
    { title: '结束时间', dataIndex: 'finished_at', key: 'finished_at', render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-' },
    { title: '触发方式', dataIndex: 'trigger_type', key: 'trigger_type', render: (v: string) => <Tag>{v === 'manual' ? '手动' : '定时'}</Tag> },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => {
      const colors: Record<string, string> = { success: 'green', partial: 'orange', failed: 'red', running: 'blue' }
      return <Tag color={colors[v] || 'default'}>{v}</Tag>
    }},
    { title: '采集账号数', dataIndex: 'accounts_crawled', key: 'accounts_crawled' },
    { title: '新增文章', dataIndex: 'articles_new', key: 'articles_new' },
    { title: '命中文章', dataIndex: 'articles_matched', key: 'articles_matched' },
    { title: '错误信息', dataIndex: 'error_message', key: 'error_message', ellipsis: true, render: (v: string) => v || '-' },
  ]

  return (
    <Table columns={columns} dataSource={data} rowKey="id" loading={loading} pagination={{ current: page, pageSize, total, onChange: (p, ps) => { setPage(p); setPageSize(ps) } }} />
  )
}
