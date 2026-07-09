'use client'

import { useState, useEffect } from 'react'
import { Form, Input, Button, Card, message } from 'antd'

export default function SettingsPage() {
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm()

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings')
      const result = await res.json()
      if (result.success) {
        form.setFieldsValue({
          api_key: result.data.api_key || '',
          cron_expression: result.data.cron_expression || '0 */2 * * *'
        })
      }
    } catch (error) { console.error(error) }
  }

  useEffect(() => { fetchSettings() }, [])

  const handleSave = async () => {
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
  }

  return (
    <Card title="系统设置" style={{ maxWidth: 600 }}>
      <Form form={form} layout="vertical">
        <Form.Item name="api_key" label="OneAPI Key" rules={[{ required: true, message: '请输入 API Key' }]}>
          <Input.Password placeholder="输入你的 getoneapi.com API Key" />
        </Form.Item>
        <Form.Item name="cron_expression" label="Cron 表达式" rules={[{ required: true }]}>
          <Input placeholder="0 */2 * * *" />
        </Form.Item>
        <Form.Item>
          <Button type="primary" loading={loading} onClick={handleSave}>保存设置</Button>
        </Form.Item>
      </Form>
      <div style={{ color: '#666', fontSize: 12, marginTop: 16 }}>
        <p>Cron 表达式说明：</p>
        <ul>
          <li><code>0 */2 * * *</code> - 每 2 小时执行一次</li>
          <li><code>0 0 */6 * * *</code> - 每 6 小时执行一次</li>
          <li><code>0 0 8,20 * * *</code> - 每天 8:00 和 20:00 执行</li>
        </ul>
      </div>
    </Card>
  )
}
