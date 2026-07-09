import { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, Tag, Space, message, Popconfirm } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { getAPI } from '../services/api';

interface Keyword {
  id: number;
  keyword: string;
  group_name: string;
  status: number;
  remark: string;
  created_at: string;
  updated_at: string;
}

export default function Keywords() {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Keyword | null>(null);
  const [form] = Form.useForm();
  const api = getAPI();

  const fetchKeywords = async () => {
    setLoading(true);
    const res = await api.getKeywords();
    if (res.success) setKeywords((res as any).data);
    setLoading(false);
  };

  useEffect(() => { fetchKeywords(); }, []);

  const handleCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const handleEdit = (record: Keyword) => {
    setEditing(record);
    form.setFieldsValue({ keyword: record.keyword, group_name: record.group_name, remark: record.remark });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    if (editing) {
      await api.updateKeyword(editing.id, values);
      message.success('更新成功');
    } else {
      await api.createKeyword(values);
      message.success('添加成功');
    }
    setModalOpen(false);
    fetchKeywords();
  };

  const handleToggle = async (id: number, status: number) => {
    await api.toggleKeyword(id, status);
    message.success(status === 1 ? '已启用' : '已停用');
    fetchKeywords();
  };

  const handleDelete = async (id: number) => {
    await api.deleteKeyword(id);
    message.success('已删除');
    fetchKeywords();
  };

  const columns = [
    { title: '关键词', dataIndex: 'keyword', key: 'keyword', width: 150, render: (v: string) => <Tag color="blue">{v}</Tag> },
    { title: '分组', dataIndex: 'group_name', key: 'group_name', width: 120, render: (v: string) => v || '-' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, render: (v: number) => v === 1 ? <Tag color="green">启用</Tag> : <Tag color="default">停用</Tag> },
    { title: '备注', dataIndex: 'remark', key: 'remark', ellipsis: true },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 180 },
    {
      title: '操作', key: 'action', width: 200,
      render: (_: unknown, record: Keyword) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.id)} />
          <Popconfirm title={record.status === 1 ? '确定停用？停用后该关键词不再参与匹配' : '确定启用？'} onConfirm={() => handleToggle(record.id, record.status === 1 ? 0 : 1)}>
            <Button size="small">{record.status === 1 ? '停用' : '启用'}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <span className="page-title">关键词管理</span>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>新增关键词</Button>
      </div>
      <Table columns={columns} dataSource={keywords} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} size="middle" />
      <Modal title={editing ? '编辑关键词' : '新增关键词'} open={modalOpen} onOk={handleSubmit} onCancel={() => setModalOpen(false)} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="keyword" label="关键词" rules={[{ required: true, message: '请输入关键词' }]}>
            <Input placeholder="例如：AI、大模型、出海" />
          </Form.Item>
          <Form.Item name="group_name" label="分组">
            <Input placeholder="可选，例如：技术、行业、竞品" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
