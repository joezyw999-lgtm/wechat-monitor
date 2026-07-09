'use client'

import { useState, useEffect } from 'react'
import { Table, Button, Modal, Form, Input, Select, Space, message, Popconfirm, Tag } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

export default function KeywordsPage() {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<any>(null)
  const [form] = Form.useForm()

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/keywords')
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
      } else {
        message.error(result.message)
      }
    } catch (error) { console.error(error) }
  }

  const handleDelete = async (id: number) => {
    try {
      const res = await fetch(`/api/keywords?id=${id}`, { method: 'DELETE' })
      const result = await res.json()
      if (result.success) { message.success('删除成功'); fetchData() }
      else message.error(result.message)
    } catch (error) { console.error(error) }
  }

  const columns = [
    { title: '关键词', dataIndex: 'keyword', key: 'keyword' },
    { title: '分组', dataIndex: 'group_name', key: 'group_name', render: (v: string) => v || '-' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => <Tag color={v === 'active' ? 'green' : 'default'}>{v === 'active' ? '启用' : '停用'}</Tag> },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
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
      <div style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingRecord(null); form.resetFields(); setModalOpen(true) }}>新增关键词</Button>
      </div>
      <Table columns={columns} dataSource={data} rowKey="id" loading={loading} />
      <Modal title={editingRecord ? '编辑关键词' : '新增关键词'} open={modalOpen} onOk={handleSave} onCancel={() => setModalOpen(false)}>
        <Form form={form} layout="vertical">
          <Form.Item name="keyword" label="关键词" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="groupName" label="分组"><Input placeholder="可选" /></Form.Item>
          <Form.Item name="status" label="状态" initialValue="active"><Select options={[{ value: 'active', label: '启用' }, { value: 'paused', label: '停用' }]} /></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
