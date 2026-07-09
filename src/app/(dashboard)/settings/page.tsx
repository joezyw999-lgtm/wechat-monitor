'use client'

import { useState, useEffect, useCallback } from 'react'
import { Form, Input, Button, Card, message, Spin } from 'antd'

export default function SettingsPage() {
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [form] = Form.useForm()

  const fetchSettings = useCallback(async () => {
    setFetching(true)
    try {
      const res = await fetch('/api/settings')
      const result = await res.json()
      if (result.success) {
        form.setFieldsValue({
          api_key: result.data.api_key || '',
          cron_expression: result.data.cron_expression || '0 8 * * *'
        })
      }
    } catch (error) { console.error(error) }
    finally { setFetching(false) }
  }, [form])

  useEffect(() => { fetchSettings() }, [fetchSettings])

  const handleSave = useCallback(async () => {
    setLoading(true)
    try {
      const values = await form.validateFields()
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      })
      const result = await res.json()
      if (result.success) {
        message.success('保存成功')
      } else {
        message.error(result.message)
      }
    } catch (error) { console.error(error) }
    finally { setLoading(false) }
  }, [form])

  if (fetching) {
    return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>
  }

  return (
    <Card title="系统设置" style={{ maxWidth: 600 }}>
      <Form form={form} layout="vertical">
        <Form.Item name="api_key" label="OneAPI Key" rules={[{ required: true, message: '请输入 API Key' }]}>
          <Input.Password placeholder="输入你的 getoneapi.com API Key" />
        </Form.Item>
        <Form.Item name="cron_expression" label="Cron 表达式" rules={[{ required: true }]}>
          <Input placeholder="0 8 * * *" />
        </Form.Item>
        <Form.Item>
          <Button type="primary" loading={loading} onClick={handleSave}>保存设置</Button>
        </Form.Item>
      </Form>
      <div style={{ color: '#666', fontSize: 12, marginTop: 16 }}>
        <p>Cron 表达式说明（Vercel 免费版仅支持每天一次）：</p>
        <ul style={{ paddingLeft: 20 }}>
          <li><code>0 8 * * *</code> - 每天 UTC 8:00（北京时间 16:00）</li>
          <li><code>0 0 * * *</code> - 每天 UTC 0:00（北京时间 8:00）</li>
        </ul>
      </div>
    </Card>
  )
}
