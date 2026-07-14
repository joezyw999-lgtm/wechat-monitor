'use client'

import { useState, useCallback, useEffect } from 'react'
import { Table, Button, Input, DatePicker, Select, Space, Tag, message, Modal, Popconfirm } from 'antd'
import { SearchOutlined, ReloadOutlined, DeleteOutlined, CheckCircleOutlined, DownloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useCache } from '@/lib/cache'

const { RangePicker } = DatePicker

export default function ArticlesPage() {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [filters, setFilters] = useState({ keyword: '', accountId: '', category: '', isRead: '', startDate: '', endDate: '' })
  const [accounts, setAccounts] = useState<any[]>([])
  const [categories] = useState(['官方', '高校', '竞对'])
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const cache = useCache()

  const cacheKey = `articles-${page}-${pageSize}-${JSON.stringify(filters)}`

  const fetchData = useCallback(async () => {
    const cached = cache.get(cacheKey)
    if (cached) {
      setData(cached.list || [])
      setTotal(cached.total || 0)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', page.toString())
      params.set('pageSize', pageSize.toString())
      if (filters.keyword) params.set('keyword', filters.keyword)
      if (filters.accountId) params.set('accountId', filters.accountId)
      if (filters.category) params.set('category', filters.category)
      if (filters.isRead) params.set('isRead', filters.isRead)
      if (filters.startDate) params.set('startDate', filters.startDate)
      if (filters.endDate) params.set('endDate', filters.endDate)

      const res = await fetch(`/api/articles?${params.toString()}`)
      const result = await res.json()
      if (result.success) {
        setData(result.data.list)
        setTotal(result.data.total ?? 0)
        cache.set(cacheKey, result.data)
      } else {
        message.error(result.message || '获取文章列表失败')
      }
    } catch (error: any) {
      message.error(error.message || '获取文章列表失败')
    }
    finally { setLoading(false) }
  }, [cache, cacheKey])

  const handleSearch = useCallback(() => {
    setPage(1)
    setSelectedRowKeys([])
    setTimeout(() => fetchData(), 0)
  }, [fetchData])

  const handleDateChange = useCallback((dates: any) => {
    if (dates) {
      setFilters(prev => ({ ...prev, startDate: dates[0]?.format('YYYY-MM-DD') || '', endDate: dates[1]?.format('YYYY-MM-DD') || '' }))
    } else {
      setFilters(prev => ({ ...prev, startDate: '', endDate: '' }))
    }
    setPage(1)
    setSelectedRowKeys([])
  }, [])

  const handleFilterChange = useCallback((key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }))
    setPage(1)
    setSelectedRowKeys([])
  }, [])

  const handleMarkRead = useCallback(async (id: string, isRead: boolean) => {
    setData(prev => prev.map(item => item.id === id ? { ...item, is_read: isRead } : item))
    try {
      await fetch('/api/articles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isRead })
      })
      cache.invalidate('dashboard-stats')
    } catch (error) {
      console.error(error)
      setData(prev => prev.map(item => item.id === id ? { ...item, is_read: !isRead } : item))
    }
  }, [cache])

  const handleBatchDelete = useCallback(() => {
    if (selectedRowKeys.length === 0) return
    Modal.confirm({
      title: '确认删除',
      content: `确定删除选中的 ${selectedRowKeys.length} 篇文章吗？删除后不可恢复。`,
      okText: '确认删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await fetch('/api/articles', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: selectedRowKeys })
          })
          const result = await res.json()
          if (result.success) {
            message.success(`成功删除 ${result.data.deleted} 篇文章`)
            setSelectedRowKeys([])
            cache.invalidate('dashboard-stats')
            fetchData()
          } else {
            message.error(result.message || '删除失败')
          }
        } catch (error: any) {
          message.error(error.message || '删除失败')
        }
      }
    })
  }, [selectedRowKeys, cache, fetchData])

  const handleMarkAllRead = useCallback(() => {
    Modal.confirm({
      title: '确认全部标记已读',
      content: '确定将当前筛选条件下的所有文章标记为已读吗？',
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await fetch('/api/articles', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              markAll: true,
              isRead: true,
              filters
            })
          })
          const result = await res.json()
          if (result.success) {
            message.success(`成功标记 ${result.data.updated} 篇为已读`)
            cache.invalidate('dashboard-stats')
            fetchData()
          } else {
            message.error(result.message || '操作失败')
          }
        } catch (error: any) {
          message.error(error.message || '操作失败')
        }
      }
    })
  }, [filters, cache, fetchData])

  useEffect(() => {
    fetchData()
    fetch('/api/accounts').then(r => r.json()).then(r => r.success && setAccounts(r.data))
  }, [])

  const handleExport = useCallback(async () => {
    const params = new URLSearchParams()
    if (filters.keyword) params.set('keyword', filters.keyword)
    if (filters.accountId) params.set('accountId', filters.accountId)
    if (filters.category) params.set('category', filters.category)
    if (filters.isRead) params.set('isRead', filters.isRead)
    if (filters.startDate) params.set('startDate', filters.startDate.format('YYYY-MM-DD'))
    if (filters.endDate) params.set('endDate', filters.endDate.format('YYYY-MM-DD'))

    try {
      const res = await fetch(`/api/articles/export?${params.toString()}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        message.error(err.message || '导出失败')
        return
      }
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `文章列表_${dayjs().format('YYYYMMDD_HHmmss')}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
      message.success('导出成功')
    } catch (error: any) {
      message.error(error.message || '导出失败')
    }
  }, [filters])

  const columns = [
    { title: '标题', dataIndex: 'title', key: 'title', ellipsis: true, render: (v: string, r: any) => <a href={r.original_url || r.url} target="_blank" rel="noopener noreferrer" onClick={() => handleMarkRead(r.id, true)} style={{ fontWeight: r.is_read ? 'normal' : 500 }}>{v}</a> },
    { title: '公众号', dataIndex: 'account_name', key: 'account_name', width: 120, ellipsis: true },
    { title: '分类', dataIndex: 'category', key: 'category', width: 80, render: (v: string) => {
      const colorMap: Record<string, string> = { '官方': 'blue', '高校': 'green', '竞对': 'orange' }
      return v ? <Tag color={colorMap[v] || 'default'}>{v}</Tag> : '-'
    }},
    { title: '匹配关键词', dataIndex: 'matched_keywords', key: 'matched_keywords', width: 150, render: (v: string | string[]) => {
      if (!v) return '-'
      const keywords = typeof v === 'string' ? v.split(',') : v
      return keywords.map((k: string) => <Tag color="blue" key={k}>{k}</Tag>)
    }},
    { title: '发布时间', dataIndex: 'published_at', key: 'published_at', width: 160, render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-' },
    { title: '状态', dataIndex: 'is_read', key: 'is_read', width: 80, render: (v: boolean) => <Tag color={v ? 'default' : 'red'}>{v ? '已读' : '未读'}</Tag> }
  ]

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Input 
          placeholder="搜索标题/摘要" 
          prefix={<SearchOutlined />} 
          value={filters.keyword} 
          onChange={e => setFilters({ ...filters, keyword: e.target.value })} 
          style={{ width: 200 }} 
          onPressEnter={handleSearch}
          allowClear
        />
        <Select 
          placeholder="公众号" 
          style={{ width: 150 }} 
          allowClear 
          showSearch
          optionFilterProp="label"
          onChange={v => handleFilterChange('accountId', v || '')}
          options={accounts.map((a: any) => ({ value: a.id, label: a.name }))}
        />
        <Select 
          placeholder="分类" 
          style={{ width: 120 }} 
          allowClear 
          onChange={v => handleFilterChange('category', v || '')}
          options={[
            { value: '官方', label: '官方' },
            { value: '高校', label: '高校' },
            { value: '竞对', label: '竞对' },
          ]}
        />
        <RangePicker 
          onChange={handleDateChange}
        />
        <Select 
          placeholder="阅读状态" 
          style={{ width: 120 }} 
          allowClear 
          onChange={v => handleFilterChange('isRead', v || '')}
          options={[{ value: 'true', label: '已读' }, { value: 'false', label: '未读' }]} 
        />
        <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>搜索</Button>
        <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
        <Button icon={<DownloadOutlined />} onClick={handleExport}>导出Excel</Button>
        <Popconfirm
          title="确认全部标记已读"
          description="将当前筛选条件下的所有文章标记为已读，确定要继续吗？"
          onConfirm={handleMarkAllRead}
          okText="确定"
          cancelText="取消"
        >
          <Button icon={<CheckCircleOutlined />}>全部标记已读</Button>
        </Popconfirm>
        <Button 
          danger 
          icon={<DeleteOutlined />}
          disabled={selectedRowKeys.length === 0}
          onClick={handleBatchDelete}
        >
          删除选中文章
        </Button>
      </Space>
      <Table 
        columns={columns} 
        dataSource={data} 
        rowKey="id" 
        loading={loading}
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
        pagination={{ 
          current: page, 
          pageSize, 
          total, 
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); setSelectedRowKeys([]) } 
        }}
        size="middle"
      />
    </div>
  )
}
