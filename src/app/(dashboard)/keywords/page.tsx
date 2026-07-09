'use client'

import { useState, useCallback, useEffect } from 'react'
import { Table, Button, Modal, Form, Input, Select, Space, message, Popconfirm, Tag } from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useCache } from '@/lib/cache'

export default function KeywordsPage() {
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<any>(null)
  const [form] = Form.useForm()
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const cache = useCache()

  const fetchData = useCallback(async () => {
    const cached = cache.get('keywords-list')
    if (cached) {
      setData(cached)
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/keywords')
      const result = await res.json()
      if (result.success) {
        setData(result.data)
        cache.set('keywords-list', result.data)
      }
    } catch (error) { console.error(error) }
    finally { setLoading(false) }
  }, [cache])

  useEffect(() => { fetchData() }, [fetchData])

  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields()
      const isEdit = !!editingRecord
      const res = await fetch('/api/keywords', {
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
    } catch (error) { console.error(error) }
  }, [editingRecord, form, fetchData, cache])

  const handleDelete = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/keywords?id=${id}`, { method: 'DELETE' })
      const result = await res.json()
      if (result.success) { 
        message.success('删除成功')
        fetchData()
        cache.invalidate('dashboard-stats')
      } else {
        message.error(result.message)
      }
    } catch (error) { console.error(error) }
  }, [fetchData, cache])

  const columns = [
    { title: '关键词', dataIndex: 'word', key: 'word', width: 150 },
    { title: '分组', dataIndex: 'group_name', key: 'group_name', width: 120, render: (v: string) => v || '-' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, render: (v: string) => <Tag color={v === 'active' ? 'green' : 'default'}>{v === 'active' ? '启用' : '停用'}</Tag> },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 160, render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    {
      title: '操作', key: 'action', width: 150,
      render: (_: any, record: any) => (
        <Space>
          <Button size="small" onClick={() => { setEditingRecord(record); form.setFieldsValue({ ...record }); setModalOpen(true) }}>编辑</Button>
          <Popconfirm title="确定删除?" onConfirm={() => handleDelete(record.id)}><Button size="small" danger>删除</Button></Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingRecord(null); form.resetFields(); setModalOpen(true) }}>新增关键词</Button>
        <Button icon={<ReloadOutlined />} onClick={() => { cache.invalidate('keywords-list'); fetchData() }}>刷新</Button>
      </div>
      <Table columns={columns} dataSource={data} rowKey="id" loading={loading} size="middle" />

      <Modal title={editingRecord ? '编辑关键词' : '新增关键词'} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={handleSave} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="word" label="关键词" rules={[{ required: true, message: '请输入关键词' }]}>
            <Input placeholder="如: AI、大模型、出海" />
          </Form.Item>
          <Form.Item name="group_name" label="分组">
            <Input placeholder="可选，如: 技术、商业" />
          </Form.Item>
          <Form.Item name="status" label="状态" initialValue="active">
            <Select options={[{ value: 'active', label: '启用' }, { value: 'inactive', label: '停用' }]} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
