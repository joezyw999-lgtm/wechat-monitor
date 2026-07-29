'use client'

import { useState, useCallback, useEffect } from 'react'
import { Table, Tag, Button, message, Tooltip, Progress } from 'antd'
import { ReloadOutlined, PlayCircleOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useCache } from '@/lib/cache'

export default function CrawlLogsPage() {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [resuming, setResuming] = useState(false)
  const cache = useCache()
  const cacheKey = `crawl-logs-${page}-${pageSize}`

  const fetchData = useCallback(async () => {
    const cached = cache.get(cacheKey)
    if (cached) {
      setData(cached.list || [])
      setHasMore(cached.hasMore ?? true)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/crawl-logs?page=${page}&pageSize=${pageSize}`)
      const result = await res.json()
      if (result.success) {
        setData(result.data.list)
        setHasMore(result.data.hasMore)
        cache.set(cacheKey, result.data)
      } else {
        message.error(result.message || '获取采集日志失败')
      }
    } catch (error: any) {
      message.error(error?.message || '获取采集日志失败')
    }
    finally { setLoading(false) }
  }, [cache, cacheKey])

  const handleRefresh = useCallback(() => {
    cache.invalidate(cacheKey)
    fetchData()
  }, [cache, cacheKey, fetchData])

  const handleResume = useCallback(async () => {
    setResuming(true)
    try {
      const res = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume: true }),
      })
      const result = await res.json()
      if (result.success) {
        message.success(result.message || '继续采集已启动')
        cache.invalidate(cacheKey)
        fetchData()
      } else {
        message.error(result.message || '继续采集失败')
      }
    } catch (error: any) {
      message.error(error?.message || '继续采集失败')
    }
    finally { setResuming(false) }
  }, [cache, cacheKey, fetchData])

  useEffect(() => { fetchData() }, [fetchData])

  // 检查是否有未完成的任务
  const hasPartialTask = data.some((log: any) =>
    log.status === 'partial' && log.cursor_position < log.total_accounts
  )

  const columns = [
    { title: '开始时间', dataIndex: 'started_at', key: 'started_at', width: 160, render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-' },
    { title: '结束时间', dataIndex: 'finished_at', key: 'finished_at', width: 160, render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (v: string, record: any) => {
      const colors: Record<string, string> = { success: 'green', partial: 'orange', failed: 'red', running: 'blue', timeout: 'volcano', skipped: 'default' }
      const labels: Record<string, string> = { success: '成功', partial: '部分完成', failed: '失败', running: '运行中', timeout: '超时', skipped: '跳过' }
      const tag = <Tag color={colors[v] || 'default'}>{labels[v] || v}</Tag>

      // 部分完成且未完成，显示进度
      if (v === 'partial' && record.total_accounts > 0 && record.cursor_position < record.total_accounts) {
        const percent = Math.round((record.cursor_position / record.total_accounts) * 100)
        return (
          <div>
            {tag}
            <Tooltip title={`${record.cursor_position}/${record.total_accounts} 已完成`}>
              <Progress percent={percent} size="small" style={{ width: 80, marginTop: 2 }} />
            </Tooltip>
          </div>
        )
      }
      return tag
    }},
    { title: '采集账号数', dataIndex: 'accounts_crawled', key: 'accounts_crawled', width: 110, align: 'center' as const,
      render: (v: number, record: any) => {
        if (record.total_accounts > 0) {
          return `${v ?? 0} / ${record.total_accounts}`
        }
        return v ?? 0
      }
    },
    { title: '发现文章', dataIndex: 'articles_found', key: 'articles_found', width: 80, align: 'center' as const, render: (v: number) => v ?? 0 },
    { title: '命中文章', dataIndex: 'articles_matched', key: 'articles_matched', width: 80, align: 'center' as const, render: (v: number) => v ?? 0 },
    { title: '新增入库', dataIndex: 'articles_new', key: 'articles_new', width: 80, align: 'center' as const, render: (v: number) => v ?? 0 },
    { title: '使用关键词', dataIndex: 'keywords_used', key: 'keywords_used', width: 180, ellipsis: true, render: (v: string) => {
      if (!v) return <Tag color="default">全部关键词</Tag>
      const parts = v.split(',')
      if (parts.length <= 3) return parts.map((k: string) => <Tag key={k} color="blue" style={{ marginBottom: 4 }}>{k}</Tag>)
      return (
        <span title={v}>
          {parts.slice(0, 3).map((k: string) => <Tag key={k} color="blue" style={{ marginBottom: 4 }}>{k}</Tag>)}
          <Tag color="default">+{parts.length - 3}</Tag>
        </span>
      )
    }},
    { title: '信息', dataIndex: 'message', key: 'message', ellipsis: true, render: (v: string) => v || '-' },
  ]

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          {hasPartialTask && (
            <Tooltip title="从上次未完成的位置继续采集">
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                loading={resuming}
                onClick={handleResume}
              >
                继续采集
              </Button>
            </Tooltip>
          )}
        </div>
        <Button icon={<ReloadOutlined />} onClick={handleRefresh}>刷新</Button>
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
