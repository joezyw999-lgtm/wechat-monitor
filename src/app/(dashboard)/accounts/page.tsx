'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Table, Button, Modal, Form, Input, Select, Space, message, Popconfirm, Tag, Upload, Progress } from 'antd'
import { PlusOutlined, SyncOutlined, ReloadOutlined, UploadOutlined, FileTextOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useCache } from '@/lib/cache'
import type { UploadProps } from 'antd'

const CATEGORY_OPTIONS = [
  { value: '官方', label: '官方' },
  { value: '高校', label: '高校' },
  { value: '竞对', label: '竞对' },
]

const CATEGORY_COLORS: Record<string, string> = {
  '官方': 'blue',
  '高校': 'green',
  '竞对': 'orange',
}

export default function AccountsPage() {
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<any>(null)
  const [form] = Form.useForm()
  const [crawlLoading, setCrawlLoading] = useState<string | null>(null)
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importResult, setImportResult] = useState<any>(null)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cache = useCache()

  const fetchData = useCallback(async () => {
    const cached = cache.get('accounts-list')
    if (cached) {
      setData(cached)
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/accounts')
      const result = await res.json()
      if (result.success) {
        setData(result.data)
        cache.set('accounts-list', result.data)
      } else {
        message.error(result.message || '获取公众号列表失败')
      }
    } catch (error: any) {
      message.error(error.message || '获取公众号列表失败')
    } finally { setLoading(false) }
  }, [cache])

  useEffect(() => { fetchData() }, [fetchData])

  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields()
      const isEdit = !!editingRecord
      const res = await fetch('/api/accounts', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, id: editingRecord?.id })
      })
      const result = await res.json()
      if (result.success) {
        message.success(isEdit ? '更新成功' : '创建成功')
        setModalOpen(false)
        form.resetFields()
        setEditingRecord(null)
        fetchData()
        cache.invalidate('dashboard-stats')
      } else {
        message.error(result.message)
      }
    } catch (error: any) { message.error(error.message) }
  }, [editingRecord, form, fetchData, cache])

  const handleDelete = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/accounts?id=${id}`, { method: 'DELETE' })
      const result = await res.json()
      if (result.success) { 
        message.success('删除成功')
        fetchData()
        cache.invalidate('dashboard-stats')
      } else {
        message.error(result.message)
      }
    } catch (error: any) { message.error(error.message) }
  }, [fetchData, cache])

  const handleCrawl = useCallback(async (id: string) => {
    setCrawlLoading(id)
    try {
      const res = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: id })
      })
      const result = await res.json()
      if (result.success) {
        message.success(`采集完成: 新增 ${result.data.newArticles} 篇`)
        cache.invalidate('dashboard-stats')
        cache.invalidate('articles-list')
      } else {
        message.error(result.message)
      }
    } catch (error: any) { message.error(error.message) }
    finally { setCrawlLoading(null) }
  }, [cache])

  const handleImportFile = async (file: File) => {
    setImporting(true)
    setImportResult(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/accounts/import', {
        method: 'POST',
        body: formData,
      })
      const result = await res.json()

      if (result.success) {
        setImportResult(result.data)
        message.success(result.message || '导入完成')
        cache.invalidate('accounts-list')
        cache.invalidate('dashboard-stats')
        await fetchData()
      } else {
        setImportResult(result.data || null)
        message.error(result.message || '导入失败')
      }
    } catch (error: any) {
      message.error(error.message || '导入失败')
    } finally {
      setImporting(false)
    }
  }

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', width: 180 },
    { title: '原始ID', dataIndex: 'wx_id', key: 'wx_id', width: 180 },
    {
      title: '分类', dataIndex: 'category', key: 'category', width: 80,
      render: (v: string) => <Tag color={CATEGORY_COLORS[v] || 'default'}>{v || '官方'}</Tag>
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: (v: string) => <Tag color={v === 'active' ? 'green' : 'default'}>{v === 'active' ? '启用' : '停用'}</Tag>
    },
    {
      title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 160,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm')
    },
    {
      title: '操作', key: 'action', width: 250,
      render: (_: any, record: any) => (
        <Space>
          <Button size="small" icon={<SyncOutlined />} loading={crawlLoading === record.id} onClick={() => handleCrawl(record.id)}>采集</Button>
          <Button size="small" onClick={() => { setEditingRecord(record); form.setFieldsValue({ ...record }); setModalOpen(true) }}>编辑</Button>
          <Popconfirm title="确定删除?" onConfirm={() => handleDelete(record.id)}><Button size="small" danger>删除</Button></Popconfirm>
        </Space>
      )
    }
  ]

  const uploadProps: UploadProps = {
    accept: '.xlsx,.xls',
    showUploadList: false,
    beforeUpload: async (file) => {
      await handleImportFile(file)
      return false
    },
  }

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingRecord(null); form.resetFields(); setModalOpen(true) }}>新增公众号</Button>
          <Button icon={<UploadOutlined />} onClick={() => { setImportModalOpen(true); setImportResult(null) }}>批量导入</Button>
        </Space>
        <Button icon={<ReloadOutlined />} onClick={() => fetchData()}>刷新</Button>
      </div>
      <Table
        columns={columns}
        dataSource={data || []}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
        size="middle"
      />
      <Modal
        title={editingRecord ? '编辑公众号' : '新增公众号'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="公众号名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：观察者网" />
          </Form.Item>
          <Form.Item name="wx_id" label="原始ID" rules={[{ required: true, message: '请输入原始ID' }]}>
            <Input placeholder="gh_xxxxx" />
          </Form.Item>
          <Form.Item name="category" label="分类" initialValue="官方">
            <Select options={CATEGORY_OPTIONS} />
          </Form.Item>
          <Form.Item name="status" label="状态" initialValue="active">
            <Select options={[{ value: 'active', label: '启用' }, { value: 'inactive', label: '停用' }]} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="批量导入公众号"
        open={importModalOpen}
        onCancel={() => setImportModalOpen(false)}
        footer={null}
        width={560}
        destroyOnClose
      >
        <div style={{ marginBottom: 16 }}>
          <p style={{ margin: '0 0 8px 0', color: '#666' }}>
            支持 <strong>.xlsx</strong> / <strong>.xls</strong> 格式，模板字段：
          </p>
          <div style={{ background: '#f5f5f5', padding: '10px 12px', borderRadius: 6, fontSize: 13, lineHeight: 1.8 }}>
            公众号名称（必填） / 原始ID（必填） / 分类（可选：官方/高校/竞对） / 状态（可选：启用/禁用）
          </div>
        </div>

        <Upload {...uploadProps}>
          <Button type="primary" icon={<UploadOutlined />} loading={importing} block size="large">
            {importing ? '导入中...' : '选择文件并导入'}
          </Button>
        </Upload>

        {importResult && (
          <div style={{ marginTop: 20, padding: 16, background: '#f9f9f9', borderRadius: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>导入结果</div>
            <Space wrap style={{ marginBottom: 12 }}>
              <Tag color="blue">总 {importResult.total} 条</Tag>
              <Tag color="green">成功 {importResult.success} 条</Tag>
              <Tag color="orange">跳过 {importResult.skipped} 条</Tag>
              <Tag color="red">失败 {importResult.failed} 条</Tag>
            </Space>

            {importResult.failures?.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 13, color: '#cf1322', marginBottom: 6 }}>失败明细：</div>
                <div style={{ maxHeight: 150, overflowY: 'auto', fontSize: 12, color: '#666', background: '#fff', padding: '8px 12px', borderRadius: 4 }}>
                  {importResult.failures.map((f: any, i: number) => (
                    <div key={i}>第 {f.row} 行：{f.reason}</div>
                  ))}
                </div>
              </div>
            )}

            {importResult.skipped_list?.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 13, color: '#d46b08', marginBottom: 6 }}>跳过明细：</div>
                <div style={{ maxHeight: 100, overflowY: 'auto', fontSize: 12, color: '#666', background: '#fff', padding: '8px 12px', borderRadius: 4 }}>
                  {importResult.skipped_list.map((s: string, i: number) => (
                    <div key={i}>{s}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
