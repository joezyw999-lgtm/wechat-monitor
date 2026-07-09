import { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, Tag, Space, message, Popconfirm, Tooltip } from 'antd';
import { PlusOutlined, ThunderboltOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { getAPI } from '../services/api';

interface Account {
  id: number;
  name: string;
  username: string;
  status: number;
  remark: string;
  last_crawl_at: string | null;
  created_at: string;
  updated_at: string;
}

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [crawlingId, setCrawlingId] = useState<number | null>(null);
  const [form] = Form.useForm();
  const api = getAPI();

  const fetchAccounts = async () => {
    setLoading(true);
    const res = await api.getAccounts();
    if (res.success) setAccounts((res as any).data);
    setLoading(false);
  };

  useEffect(() => { fetchAccounts(); }, []);

  const handleCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const handleEdit = (record: Account) => {
    setEditing(record);
    form.setFieldsValue({ name: record.name, username: record.username, remark: record.remark });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    if (editing) {
      const res = await api.updateAccount(editing.id, values);
      if (res.success) { message.success('更新成功'); } else { message.error((res as any).message); }
    } else {
      const res = await api.createAccount(values);
      if (res.success) { message.success('添加成功'); } else { message.error((res as any).message || '添加失败'); }
    }
    setModalOpen(false);
    fetchAccounts();
  };

  const handleToggle = async (id: number, status: number) => {
    await api.toggleAccount(id, status);
    message.success(status === 1 ? '已启用' : '已停用');
    fetchAccounts();
  };

  const handleDelete = async (id: number) => {
    await api.deleteAccount(id);
    message.success('已删除');
    fetchAccounts();
  };

  const handleCrawl = async (id: number) => {
    setCrawlingId(id);
    const res = await api.crawlAccount(id);
    if (res.success) {
      message.success('采集完成');
      fetchAccounts();
    } else {
      message.error((res as any).message || '采集失败');
    }
    setCrawlingId(null);
  };

  const columns = [
    { title: '公众号名称', dataIndex: 'name', key: 'name', width: 160 },
    { title: '原始ID', dataIndex: 'username', key: 'username', width: 180, render: (v: string) => <code>{v}</code> },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, render: (v: number) => v === 1 ? <Tag color="green">启用</Tag> : <Tag color="default">停用</Tag> },
    { title: '最近采集', dataIndex: 'last_crawl_at', key: 'last_crawl_at', width: 180, render: (v: string | null) => v || '-' },
    { title: '备注', dataIndex: 'remark', key: 'remark', ellipsis: true },
    {
      title: '操作', key: 'action', width: 260,
      render: (_: unknown, record: Account) => (
        <Space>
          <Tooltip title="手动采集">
            <Button size="small" type="primary" icon={<ThunderboltOutlined />} loading={crawlingId === record.id} onClick={() => handleCrawl(record.id)} />
          </Tooltip>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.id)} />
          <Popconfirm title={record.status === 1 ? '确定停用？' : '确定启用？'} onConfirm={() => handleToggle(record.id, record.status === 1 ? 0 : 1)}>
            <Button size="small">{record.status === 1 ? '停用' : '启用'}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <span className="page-title">公众号管理</span>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>新增公众号</Button>
      </div>
      <Table columns={columns} dataSource={accounts} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} size="middle" />
      <Modal title={editing ? '编辑公众号' : '新增公众号'} open={modalOpen} onOk={handleSubmit} onCancel={() => setModalOpen(false)} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="公众号名称" rules={[{ required: true, message: '请输入公众号名称' }]}>
            <Input placeholder="例如：AI科技评论" />
          </Form.Item>
          <Form.Item name="username" label="公众号原始ID" rules={[{ required: true, message: '请输入原始ID' }, { pattern: /^gh_/, message: '格式必须为 gh_ 开头' }]} extra={!editing ? undefined : '原始ID不可修改'}>
            <Input placeholder="例如：gh_d29e0d22a6f9" disabled={!!editing} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
