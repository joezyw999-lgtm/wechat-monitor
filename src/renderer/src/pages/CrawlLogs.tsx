import { useState, useEffect } from 'react';
import { Table, Tag } from 'antd';
import { getAPI } from '../services/api';

interface CrawlLog {
  id: number;
  account_id: number;
  account_name: string;
  username: string;
  status: string;
  total_count: number;
  new_count: number;
  matched_count: number;
  error_message: string;
  started_at: string;
  finished_at: string;
}

export default function CrawlLogs() {
  const [logs, setLogs] = useState<CrawlLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const api = getAPI();

  useEffect(() => {
    const fetchLogs = async () => {
      setLoading(true);
      const res = await api.getLogs({ page, pageSize });
      if (res.success) {
        setLogs((res as any).data.list);
        setTotal((res as any).data.total);
      }
      setLoading(false);
    };
    fetchLogs();
  }, [page, pageSize, api]);

  const columns = [
    { title: '公众号', dataIndex: 'account_name', key: 'account_name', width: 140 },
    { title: '原始ID', dataIndex: 'username', key: 'username', width: 160, render: (v: string) => <code>{v}</code> },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: (v: string) => v === 'success' ? <Tag color="green">成功</Tag> : <Tag color="red">失败</Tag>,
    },
    { title: '接口返回', dataIndex: 'total_count', key: 'total_count', width: 90 },
    { title: '新增', dataIndex: 'new_count', key: 'new_count', width: 70 },
    { title: '命中', dataIndex: 'matched_count', key: 'matched_count', width: 70 },
    { title: '开始时间', dataIndex: 'started_at', key: 'started_at', width: 180 },
    { title: '结束时间', dataIndex: 'finished_at', key: 'finished_at', width: 180 },
    {
      title: '错误信息', dataIndex: 'error_message', key: 'error_message', ellipsis: true,
      render: (v: string) => v ? <span style={{ color: '#ff4d4f' }}>{v}</span> : '-',
    },
  ];

  return (
    <div>
      <div className="page-header">
        <span className="page-title">采集日志</span>
      </div>
      <Table
        columns={columns}
        dataSource={logs}
        rowKey="id"
        loading={loading}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        size="middle"
      />
    </div>
  );
}
