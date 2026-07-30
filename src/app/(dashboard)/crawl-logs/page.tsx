'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Table, Tag, Button, message, Tooltip, Progress, Space } from 'antd'
import { ReloadOutlined, PlayCircleOutlined, PlayCircleTwoTone } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useCache } from '@/lib/cache'

export default function CrawlLogsPage() {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [isCrawling, setIsCrawling] = useState(false)
  const cache = useCache()
  const cacheKey = `crawl-logs-${page}-${pageSize}`
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isAutoContinuingRef = useRef(false)

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
  }, [cache, cacheKey, page, pageSize])

  const handleRefresh = useCallback(() => {
    cache.invalidate(cacheKey)
    fetchData()
  }, [cache, cacheKey, fetchData])

  // 轮询检查采集状态
  const startPolling = useCallback(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/crawl')
        const result = await res.json()
        
        if (result.success && result.data?.current) {
          const current = result.data.current
          
          // 如果正在运行，继续轮询
          if (current.status === 'running') {
            setIsCrawling(true)
            // 更新最新一条日志
            setData(prev => {
              const idx = prev.findIndex(item => item.id === current.id)
              if (idx >= 0) {
                const newData = [...prev]
                newData[idx] = { ...newData[idx], ...current }
                return newData
              }
              return [current, ...prev].slice(0, prev.length)
            })
            pollTimerRef.current = setTimeout(poll, 4000)
            return
          }

          // 如果是 partial 且还有未完成的，自动续跑
          if (current.status === 'partial' && result.data.has_more && isAutoContinuingRef.current) {
            console.log('[Crawl Logs] Auto-continuing from partial state')
            setIsCrawling(true)
            try {
              const resumeRes = await fetch('/api/crawl', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resume: true }),
              })
              const resumeData = await resumeRes.json()
              if (resumeData.success || resumeRes.status === 409) {
                pollTimerRef.current = setTimeout(poll, 4000)
                return
              }
            } catch {
              // 续跑失败
            }
            setIsCrawling(false)
            isAutoContinuingRef.current = false
            handleRefresh()
            return
          }
        }

        // 没有运行中的任务，停止轮询
        setIsCrawling(false)
        isAutoContinuingRef.current = false
        handleRefresh()
      } catch {
        setIsCrawling(false)
        isAutoContinuingRef.current = false
      }
    }

    poll()
  }, [handleRefresh])

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const handleResume = useCallback(async () => {
    isAutoContinuingRef.current = true
    setIsCrawling(true)
    try {
      const res = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume: true }),
      })
      const result = await res.json()
      if (result.success) {
        message.success('继续采集已启动')
        cache.invalidate(cacheKey)
        startPolling()
      } else if (res.status === 409) {
        message.warning(result.message || '已有采集任务正在运行')
        startPolling()
      } else {
        message.error(result.message || '继续采集失败')
        setIsCrawling(false)
        isAutoContinuingRef.current = false
      }
    } catch (error: any) {
      message.error(error?.message || '继续采集失败')
      setIsCrawling(false)
      isAutoContinuingRef.current = false
    }
  }, [cache, cacheKey, startPolling])

  useEffect(() => { fetchData() }, [fetchData])

  // 页面加载时检查是否有运行中的任务
  useEffect(() => {
    const checkRunning = async () => {
      try {
        const res = await fetch('/api/crawl')
        const result = await res.json()
        if (result.success && result.data?.has_running) {
          setIsCrawling(true)
          isAutoContinuingRef.current = true
          startPolling()
        }
      } catch {
        // ignore
      }
    }
    checkRunning()
  }, [startPolling])

  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

  // 检查是否有未完成的任务
  const hasPartialTask = data.some((log: any) =>
    log.status === 'partial' && log.total_accounts > 0 && log.cursor_position < log.total_accounts
  )

  const columns = [
    { title: '开始时间', dataIndex: 'started_at', key: 'started_at', width: 160, render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-' },
    { title: '结束时间', dataIndex: 'finished_at', key: 'finished_at', width: 160, render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 120, render: (v: string, record: any) => {
      const colors: Record<string, string> = { success: 'green', partial: 'orange', failed: 'red', running: 'blue', timeout: 'volcano', skipped: 'default' }
      const labels: Record<string, string> = { success: '成功', partial: '部分完成', failed: '失败', running: '运行中', timeout: '超时', skipped: '跳过' }
      const tag = <Tag color={colors[v] || 'default'}>{labels[v] || v}</Tag>

      // 运行中或部分完成且未完成，显示进度
      if ((v === 'running' || v === 'partial') && record.total_accounts > 0 && record.cursor_position < record.total_accounts) {
        const percent = Math.round((record.cursor_position / record.total_accounts) * 100)
        return (
          <div>
            {tag}
            <Tooltip title={`${record.cursor_position}/${record.total_accounts} 已处理`}>
              <Progress percent={percent} size="small" status={v === 'running' ? 'active' : 'normal'} style={{ width: 80, marginTop: 2 }} />
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
        <Space>
          {hasPartialTask && !isCrawling && (
            <Tooltip title="从上次未完成的位置继续采集">
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={handleResume}
              >
                继续采集
              </Button>
            </Tooltip>
          )}
          {isCrawling && (
            <span style={{ color: '#1890ff' }}>
            <PlayCircleTwoTone /> 自动续跑中，系统将分批完成所有公众号采集
          </span>
          )}
        </Space>
        <Button icon={<ReloadOutlined />} onClick={handleRefresh}>{isCrawling ? '刷新' : '刷新'}</Button>
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
