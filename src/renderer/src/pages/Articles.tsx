import { useState, useEffect, useCallback } from 'react';
import { Table, Tag, Space, Input, Select, DatePicker, Button, Tooltip } from 'antd';
import { SearchOutlined, ReloadOutlined, LinkOutlined, EyeOutlined } from '@ant-design/icons';
import { getAPI } from '../services/api';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

interface Article {
  id: number;
  title: string;
  account_name: string;
  username: string;
  publish_time: string;
  original_url: string;
  summary: string;
  matched_keywords: string;
  is_read: number;
  crawled_at: string;
}

export default function Articles() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Filters
  const [keyword, setKeyword] = useState('');
  const [username, setUsername] = useState('');
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [isRead, setIsRead] = useState<number | undefined>(undefined);
  const [titleSearch, setTitleSearch] = useState('');

  const [accounts, setAccounts] = useState<{ id: number; name: string; username: string }[]>([]);
  const api = getAPI();

  const fetchArticles = useCallback(async () => {
    setLoading(true);
    const filters: any = { page, pageSize };
    if (keyword) filters.keyword = keyword;
    if (username) filters.username = username;
    if (dateRange) {
      filters.start_time = dateRange[0].format('YYYY-MM-DD 00:00:00');
      filters.end_time = dateRange[1].format('YYYY-MM-DD 23:59:59');
    }
    if (isRead !== undefined) filters.is_read = isRead;
    if (titleSearch) filters.title_search = titleSearch;

    const res = await api.getArticles(filters);
    if (res.success) {
      setArticles((res as any).data.list);
      setTotal((res as any).data.total);
    }
    setLoading(false);
  }, [page, pageSize, keyword, username, dateRange, isRead, titleSearch, api]);

  useEffect(() => {
    api.getAccounts().then((res) => {
      if (res.success) setAccounts((res as any).data);
    });
  }, [api]);

  useEffect(() => { fetchArticles(); }, [fetchArticles]);

  const handleMarkRead = async (id: number, isReadVal: number) => {
    await api.markArticleRead(id, isReadVal);
    fetchArticles();
  };

  const handleOpenOriginal = (url: string, id: number) => {
    window.open(url, '_blank');
    handleMarkRead(id, 1);
  };

  const handleSearch = () => {
    setPage(1);
    fetchArticles();
  };

  const handleReset = () => {
    setKeyword('');
    setUsername('');
    setDateRange(null);
    setIsRead(undefined);
    setTitleSearch('');
    setPage(1);
  };

  const columns = [
    {
      title: '文章标题', dataIndex: 'title', key: 'title', ellipsis: true, width: 300,
      render: (text: string, record: Article) => (
        <a className="article-title-link" onClick={() => handleOpenOriginal(record.original_url, record.id)} style={{ fontWeight: record.is_read === 0 ? 600 : 400 }}>
          {text}
        </a>
      ),
    },
    { title: '公众号', dataIndex: 'account_name', key: 'account_name', width: 120, ellipsis: true },
    { title: '发布时间', dataIndex: 'publish_time', key: 'publish_time', width: 170 },
    {
      title: '命中关键词', dataIndex: 'matched_keywords', key: 'matched_keywords', width: 200,
      render: (v: string) => v ? v.split(',').map((kw) => <Tag key={kw} color="blue" className="keyword-tag">{kw}</Tag>) : '-',
    },
    {
      title: '已读', dataIndex: 'is_read', key: 'is_read', width: 70,
      render: (v: number) => v === 1 ? <Tag color="default">已读</Tag> : <Tag color="orange">未读</Tag>,
    },
    {
      title: '操作', key: 'action', width: 150,
      render: (_: unknown, record: Article) => (
        <Space>
          <Tooltip title="查看原文">
            <Button size="small" type="link" icon={<LinkOutlined />} onClick={() => handleOpenOriginal(record.original_url, record.id)} />
          </Tooltip>
          {record.is_read === 0 ? (
            <Tooltip title="标记已读">
              <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => handleMarkRead(record.id, 1)} />
            </Tooltip>
          ) : (
            <Tooltip title="标记未读">
              <Button size="small" type="link" onClick={() => handleMarkRead(record.id, 0)}>未读</Button>
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="page-header">
        <span className="page-title">文章列表</span>
      </div>
      <div className="filter-bar">
        <Input placeholder="搜索标题" prefix={<SearchOutlined />} value={titleSearch} onChange={(e) => setTitleSearch(e.target.value)} style={{ width: 200 }} onPressEnter={handleSearch} allowClear />
        <Input placeholder="关键词筛选" value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 150 }} onPressEnter={handleSearch} allowClear />
        <Select placeholder="公众号" value={username || undefined} onChange={(v) => setUsername(v || '')} style={{ width: 160 }} allowClear>
          {accounts.map((a) => <Select.Option key={a.username} value={a.username}>{a.name}</Select.Option>)}
        </Select>
        <Select placeholder="已读状态" value={isRead} onChange={(v) => setIsRead(v)} style={{ width: 120 }} allowClear>
          <Select.Option value={0}>未读</Select.Option>
          <Select.Option value={1}>已读</Select.Option>
        </Select>
        <RangePicker value={dateRange} onChange={(v) => setDateRange(v as [dayjs.Dayjs, dayjs.Dayjs] | null)} />
        <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>搜索</Button>
        <Button icon={<ReloadOutlined />} onClick={handleReset}>重置</Button>
      </div>
      <Table
        columns={columns}
        dataSource={articles}
        rowKey="id"
        loading={loading}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 篇`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        size="middle"
        rowClassName={(record) => record.is_read === 0 ? '' : 'row-read'}
      />
    </div>
  );
}
