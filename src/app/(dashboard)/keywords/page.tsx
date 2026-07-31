'use client'

import React, { useState, useCallback, useMemo } from 'react'
import { Card, Button, Table, Modal, Form, Input, Select, Switch, message, Space, Tag, Tabs } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { useCachedFetch } from '@/lib/cache'

interface Keyword {
  id: number
  word: string
  group_name: string | null
  type: 'include' | 'exclude'
  status: 'active' | 'inactive'
  created_at: string
}

const KeywordModal = ({ 
  open, 
  initialData, 
  keywordType,
  onCancel, 
  onSubmit 
}: { 
  open: boolean
  initialData: Keyword | null
  keywordType: 'include' | 'exclude'
  onCancel: () => void
  onSubmit: (values: any) => Promise<void>
}) => {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)

  React.useEffect(() => {
    if (open) {
      if (initialData) {
        form.setFieldsValue({
          word: initialData.word,
          groupName: initialData.group_name,
          status: initialData.status === 'active'
        })
      } else {
        form.resetFields()
        form.setFieldsValue({ status: true })
      }
    }
  }, [open, initialData, form])

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      setLoading(true)
      await onSubmit({
        word: values.word,
        groupName: values.groupName || null,
        type: keywordType,
        status: values.status ? 'active' : 'inactive'
      })
      setLoading(false)
    } catch (e: any) {
      setLoading(false)
      if (e.errorFields) return
      message.error(e.message || '保存失败')
    }
  }

  return (
    <Modal
      title={initialData ? '编辑关键词' : '新增关键词'}
      open={open}
      onCancel={onCancel}
      onOk={handleSubmit}
      confirmLoading={loading}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="word"
          label="关键词"
          rules={[{ required: true, message: '请输入关键词' }]}
        >
          <Input placeholder="请输入关键词" />
        </Form.Item>
        <Form.Item name="groupName" label="分组名称">
          <Input placeholder="可选：按分组管理关键词" />
        </Form.Item>
        <Form.Item name="status" label="状态" valuePropName="checked">
          <Switch checkedChildren="启用" unCheckedChildren="停用" />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default function KeywordsPage() {
  const [activeTab, setActiveTab] = useState<'include' | 'exclude'>('include')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingKeyword, setEditingKeyword] = useState<Keyword | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const fetchKeywords = useCallback(async () => {
    const res = await fetch(`/api/keywords?type=${activeTab}&page=${page}&pageSize=${pageSize}`)
    const d = await res.json()
    return d.data || { list: [], total: 0 }
  }, [activeTab, page, pageSize])

  const { data, loading, refresh } = useCachedFetch(`keywords-${activeTab}-${page}-${pageSize}`, fetchKeywords)

  const columns = useMemo(() => [
    {
      title: 'ID',
      dataIndex: 'id',
      width: 70
    },
    {
      title: '关键词',
      dataIndex: 'word',
      width: 200
    },
    {
      title: '分组',
      dataIndex: 'group_name',
      width: 140,
      render: (v: string | null) => v ? <Tag>{v}</Tag> : '-'
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => (
        <Tag color={v === 'active' ? 'green' : 'default'}>
          {v === 'active' ? '启用' : '停用'}
        </Tag>
      )
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 180,
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-'
    },
    {
      title: '操作',
      width: 160,
      render: (_: any, record: Keyword) => (
        <Space size="small">
          <Button 
            type="link" 
            size="small" 
            icon={<EditOutlined />}
            onClick={() => {
              setEditingKeyword(record)
              setModalOpen(true)
            }}
          >
            编辑
          </Button>
          <Button 
            type="link" 
            size="small" 
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record.id)}
          >
            删除
          </Button>
        </Space>
      )
    }
  ], [])

  const handleDelete = useCallback(async (id: number) => {
    Modal.confirm({
      title: '确认删除',
      content: '删除后无法恢复，确认删除该关键词吗？',
      okType: 'danger',
      onOk: async () => {
        try {
          const res = await fetch(`/api/keywords?id=${id}`, { method: 'DELETE' })
          const data = await res.json()
          if (data.success) {
            message.success('删除成功')
            refresh()
          } else {
            message.error(data.error || '删除失败')
          }
        } catch (e: any) {
          message.error(e.message || '删除失败')
        }
      }
    })
  }, [refresh])

  const handleSubmit = useCallback(async (values: any) => {
    try {
      const url = editingKeyword 
        ? `/api/keywords?id=${editingKeyword.id}` 
        : '/api/keywords'
      const method = editingKeyword ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      })
      const data = await res.json()
      if (data.success) {
        message.success('保存成功')
        setModalOpen(false)
        setEditingKeyword(null)
        refresh()
      } else {
        throw new Error(data.error || '保存失败')
      }
    } catch (e: any) {
      message.error(e.message || '保存失败')
    }
  }, [editingKeyword, refresh])

  const handleTabChange = (key: string) => {
    setActiveTab(key as 'include' | 'exclude')
    setPage(1)
  }

  const tabItems = [
    {
      key: 'include',
      label: '监控关键词',
    },
    {
      key: 'exclude',
      label: '屏蔽关键词',
    }
  ]

  return (
    <div className="p-6">
      <Card
        title={
          <Tabs 
            activeKey={activeTab} 
            onChange={handleTabChange}
            items={tabItems}
            size="small"
            style={{ marginBottom: -16 }}
          />
        }
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingKeyword(null)
              setModalOpen(true)
            }}
          >
            新增{activeTab === 'include' ? '监控' : '屏蔽'}关键词
          </Button>
        }
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data?.list || []}
          loading={loading}
          pagination={{
            current: page,
            pageSize,
            total: data?.total || 0,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (p, ps) => {
              setPage(p)
              setPageSize(ps)
            }
          }}
        />
      </Card>

      <KeywordModal
        open={modalOpen}
        initialData={editingKeyword}
        keywordType={activeTab}
        onCancel={() => {
          setModalOpen(false)
          setEditingKeyword(null)
        }}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
