import { useState, useEffect } from 'react';
import { Card, Row, Col, Statistic, Button, message, Spin } from 'antd';
import {
  UserOutlined,
  KeyOutlined,
  FileTextOutlined,
  EyeInvisibleOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { getAPI } from '../services/api';

export default function Dashboard() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [crawling, setCrawling] = useState(false);
  const api = getAPI();

  const fetchStats = async () => {
    setLoading(true);
    const res = await api.getStats();
    if (res.success) setStats((res as any).data);
    setLoading(false);
  };

  useEffect(() => { fetchStats(); }, []);

  const handleCrawlAll = async () => {
    setCrawling(true);
    const res = await api.crawlAll();
    if (res.success) {
      message.success('采集任务已触发');
      setTimeout(fetchStats, 1000);
    } else {
      message.error((res as any).message || '采集失败');
    }
    setCrawling(false);
  };

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;

  return (
    <div>
      <div className="page-header">
        <span className="page-title">仪表盘</span>
        <Button type="primary" icon={<ThunderboltOutlined />} loading={crawling} onClick={handleCrawlAll}>
          立即采集全部
        </Button>
      </div>
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={8} md={4}>
          <Card className="stat-card">
            <Statistic title="监控公众号" value={stats?.accountCount || 0} prefix={<UserOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card className="stat-card">
            <Statistic title="启用中" value={stats?.activeAccountCount || 0} prefix={<CheckCircleOutlined />} valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card className="stat-card">
            <Statistic title="关键词数" value={stats?.keywordCount || 0} prefix={<KeyOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card className="stat-card">
            <Statistic title="命中文章" value={stats?.articleCount || 0} prefix={<FileTextOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card className="stat-card">
            <Statistic title="未读文章" value={stats?.unreadCount || 0} prefix={<EyeInvisibleOutlined />} valueStyle={{ color: '#faad14' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card className="stat-card">
            <Statistic title="今日新增" value={stats?.todayArticles || 0} prefix={<ThunderboltOutlined />} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
