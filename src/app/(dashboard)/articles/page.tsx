'use client'

import { useState, useEffect } from 'react'
import { Table, Button, Input, DatePicker, Select, Space, Tag, message } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

const { RangePicker } = DatePicker

export default function ArticlesPage() {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [filters, setFilters] = useState({ keyword: '', accountId: '', isRead: '', startDate: '', endDate: '' })

  const fetchData = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', page.toString())
      params.set('pageSize', pageSize.toString())
      if (filters.keyword) params.set('keyword', filters.keyword)
      if (filters.accountId) params.set('accountId', filters.accountId)
      if (filters.isRead) params.set('isRead', filters.isRead)
      if (filters.startDate) params.set('startDate', filters.startDate)
      if (filters.endDate) params.set('endDate', filters.endDate)

      const res = await fetch(`/api/articles?${params.toString()}`)
      const result = await res.json()
      if (result.success) {
        setData(result.data.list)
        setTotal(result.data.total)
      }
    } catch (error) { console.error(error) }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchData() }, [page, pageSize])

  const handleMarkRead = async (id: number, isRead: boolean) => {
    try {
      const res = await fetch('/api/articles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isRead })
      })
      const result = await res.json()
      if (result.success) fetchData()
    } catch (error) { console.error(error) }
  }

  const columns = [
    { title: '标题', dataIndex: 'title', key: 'title', ellipsis: true, render: (v: string, r: any) => <a href={r.url} target="_blank" rel="noopener noreferrer" onClick={() => handleMarkRead(r.id, true)}>{v}</a> },
    { title: '作者', dataIndex: 'author', key: 'author', width: 120 },
    { title: '匹配关键词', dataIndex: 'matched_keywords', key: 'matched_keywords', width: 150, render: (v: string[]) => v?.map(k => <Tag color="blue" key={k}>{k}</Tag>) || '-' },
    { title: '发布时间', dataIndex: 'published_at', key: 'published_at', width: 160, render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    { title: '状态', dataIndex: 'is_read', key: 'is_read', width: 80, render: (v: boolean) => <Tag color={v ? 'default' : 'red'}>{v ? '已读' : '未读'}</Tag> },
    {
      title: '操作', key: 'action', width: 100,
      render: (_: any, record: any) => (
        <Button size="small" type="link" onClick={() => handleMarkRead(record.id, !record.is_read)}>
          {record.is_read ? '标为未读' : '标为已读'}
        </Button>
      )
    }
  ]

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Input placeholder="搜索标题/摘要" prefix={<SearchOutlined />} value={filters.keyword} onChange={e => setFilters({ ...filters, keyword: e.target.value })} style={{ width: 200 }} onPressEnter={() => { setPage(1); fetchData() }} />
        <RangePicker onChange={(dates) => {
          if (dates) {
            setFilters({ ...filters, startDate: dates[0]?.format('YYYY-MM-DD') || '', endDate: dates[1]?.format('YYYY-MM-DD') || '' })
          } else {
            setFilters({ ...filters, startDate: '', endDate: '' })
          }
          setPage(1)
        }} />
        <Select placeholder="阅读状态" style={{ width: 120 }} allowClear onChange={v => { setFilters({ ...filters, isRead: v || '' }); setPage(1) }} options={[{ value: 'true', label: '已读' }, { value: 'false', label: '未读' }]} />
        <Button type="primary" icon={<SearchOutlined />} onClick={() => { setPage(1); fetchData() }}>搜索</Button>
      </Space>
      <Table columns={columns} dataSource={data} rowKey="id" loading={loading} pagination={{ current: page, pageSize, total, onChange: (p, ps) => { setPage(p); setPageSize(ps) } }} />
    </div>
  )
}
