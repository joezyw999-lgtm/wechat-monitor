import { useState, useEffect } from 'react';
import { Card, Form, Input, Button, message, Divider, Alert } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { getAPI } from '../services/api';

export default function Settings() {
  const [apiKey, setApiKey] = useState('');
  const [cronExpr, setCronExpr] = useState('0 * * * *');
  const [loading, setLoading] = useState(false);
  const api = getAPI();

  useEffect(() => {
    const loadSettings = async () => {
      const keyRes = await api.getSetting('api_key');
      if (keyRes.success) setApiKey((keyRes as any).data || '');
      const cronRes = await api.getSetting('cron_expression');
      if (cronRes.success) setCronExpr((cronRes as any).data || '0 * * * *');
    };
    loadSettings();
  }, [api]);

  const handleSave = async () => {
    setLoading(true);
    await api.setSetting('api_key', apiKey);
    await api.setSetting('cron_expression', cronExpr);
    message.success('设置已保存');
    setLoading(false);
  };

  return (
    <div>
      <div className="page-header">
        <span className="page-title">系统设置</span>
      </div>
      <Card style={{ maxWidth: 600 }}>
        <Alert
          message="API Key 安全提示"
          description="API Key 存储在本地数据库中，请勿泄露给他人。生产环境建议通过环境变量注入。"
          type="warning"
          showIcon
          style={{ marginBottom: 24 }}
        />
        <Form layout="vertical">
          <Form.Item label="OneAPI Key" required>
            <Input.Password
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="请输入 api.getoneapi.com 的 API Key"
            />
          </Form.Item>
          <Form.Item
            label="采集频率 (Cron 表达式)"
            extra="默认每小时执行一次。格式：秒 分 时 日 月 周"
          >
            <Input
              value={cronExpr}
              onChange={(e) => setCronExpr(e.target.value)}
              placeholder="0 * * * *"
            />
          </Form.Item>
          <Divider />
          <Form.Item>
            <Button type="primary" icon={<SaveOutlined />} loading={loading} onClick={handleSave}>
              保存设置
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Card title="常用 Cron 表达式参考" style={{ maxWidth: 600, marginTop: 16 }}>
        <ul style={{ paddingLeft: 20, color: '#666' }}>
          <li><code>0 * * * *</code> - 每小时执行一次</li>
          <li><code>0 */2 * * *</code> - 每 2 小时执行一次</li>
          <li><code>0 */30 * * * *</code> - 每 30 分钟执行一次</li>
          <li><code>0 0 8,12,18 * * *</code> - 每天 8:00、12:00、18:00 各执行一次</li>
          <li><code>0 0 9 * * *</code> - 每天早上 9:00 执行一次</li>
        </ul>
      </Card>
    </div>
  );
}
