'use client'

import { useState, useEffect } from 'react'
import { Table, Button, Modal, Form, Input, Select, Space, message, Popconfirm, Tag } from 'antd'
import { PlusOutlined, SyncOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

export default function AccountsPage() {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<any>(null)
  const [form] = Form.useForm()
  const [crawlLoading, setCrawlLoading] = useState<number | null>(null)

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/accounts')
      const result = await res.json()
      if (result.success) setData(result.data)
    } catch (error) { console.error(error) }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchData() }, [])

  const handleSave = async () => {
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
      } else {
        message.error(result.message)
      }
    } catch (error) { console.error(error) }
  }

  const handleDelete = async (id: number) => {
    try {
      const res = await fetch(`/api/accounts?id=${id}`, { method: 'DELETE' })
      const result = await res.json()
      if (result.success) { message.success('删除成功'); fetchData() }
      else message.error(result.message)
    } catch (error) { console.error(error) }
  }

  const handleCrawl = async (id: number) => {
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
      } else {
        message.error(result.message)
      }
    } catch (error: any) { message.error(error.message) }
    finally { setCrawlLoading(null) }
  }

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '原始ID', dataIndex: 'biz_id', key: 'biz_id' },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => <Tag color={v === 'active' ? 'green' : 'default'}>{v === 'active' ? '启用' : '停用'}</Tag> },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
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

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingRecord(null); form.resetFields(); setModalOpen(true) }}>新增公众号</Button>
      </div>
      <Table columns={columns} dataSource={data} rowKey="id" loading={loading} />
      <Modal title={editingRecord ? '编辑公众号' : '新增公众号'} open={modalOpen} onOk={handleSave} onCancel={() => setModalOpen(false)}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="bizId" label="原始ID (gh_xxx)" rules={[{ required: true }]}><Input placeholder="gh_xxxxx" /></Form.Item>
          <Form.Item name="description" label="描述"><Input.TextArea /></Form.Item>
          <Form.Item name="status" label="状态" initialValue="active"><Select options={[{ value: 'active', label: '启用' }, { value: 'paused', label: '停用' }]} /></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
