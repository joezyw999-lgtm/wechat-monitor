'use client'

import { useState, useEffect, useCallback } from 'react'
import { Form, Input, InputNumber, Button, Card, message, Spin } from 'antd'

export default function SettingsPage() {
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [form] = Form.useForm()

  const [maskedKey, setMaskedKey] = useState(false)

  const fetchSettings = useCallback(async () => {
    setFetching(true)
    try {
      const res = await fetch('/api/settings')
      const result = await res.json()
      if (result.success) {
        const apiKey = result.data.oneapi_key || result.data.api_key || ''
        // Check if the key is masked (contains ****)
        if (apiKey.includes('****')) {
          setMaskedKey(true)
          form.setFieldsValue({
            api_key: '', // Don't show masked value in form
            cron_expression: result.data.cron_expression || '0 8 * * *',
            article_count: result.data.article_count || 20
          })
        } else {
          setMaskedKey(false)
          form.setFieldsValue({
            api_key: apiKey,
            cron_expression: result.data.cron_expression || '0 8 * * *',
            article_count: result.data.article_count || 20
          })
        }
      }
    } catch (error) { console.error(error) }
    finally { setFetching(false) }
  }, [form])

  useEffect(() => { fetchSettings() }, [fetchSettings])

  const handleSave = useCallback(async () => {
    setLoading(true)
    try {
      const values = await form.validateFields()
      // If the API key field is empty and was masked, don't send it (keep existing)
      const payload: Record<string, any> = {
        cron_expression: values.cron_expression,
        article_count: values.article_count
      }
      // Only include API key if user entered a new one
      if (values.api_key && !values.api_key.includes('****')) {
        payload.api_key = values.api_key
      }
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const result = await res.json()
      if (result.success) {
        message.success('保存成功')
        // Refresh settings to show masked key again
        fetchSettings()
      } else {
        message.error(result.message)
      }
    } catch (error) { console.error(error) }
    finally { setLoading(false) }
  }, [form, fetchSettings])

  if (fetching) {
    return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>
  }

  return (
    <Card title="系统设置" style={{ maxWidth: 600 }}>
      <Form form={form} layout="vertical">
        <Form.Item 
          name="api_key" 
          label="OneAPI Key" 
          rules={[{ required: !maskedKey, message: '请输入 API Key' }]}
          extra={maskedKey ? '已配置，留空则保持不变' : undefined}
        >
          <Input.Password 
            placeholder={maskedKey ? '已配置，输入新 Key 可替换' : '输入你的 getoneapi.com API Key'} 
          />
        </Form.Item>
        <Form.Item name="article_count" label="每次采集文章数量" rules={[{ required: true, message: '请输入采集数量' }]}>
          <InputNumber min={1} max={100} style={{ width: '100%' }} placeholder="默认 20" />
        </Form.Item>
        <Form.Item name="cron_expression" label="Cron 表达式" rules={[{ required: true }]}>
          <Input placeholder="0 8 * * *" />
        </Form.Item>
        <Form.Item>
          <Button type="primary" loading={loading} onClick={handleSave}>保存设置</Button>
        </Form.Item>
      </Form>
      <div style={{ color: '#666', fontSize: 12, marginTop: 16 }}>
        <p><strong>采集数量说明：</strong></p>
        <ul style={{ paddingLeft: 20 }}>
          <li>每次采集时，每个公众号获取最新的 N 篇文章</li>
          <li>数量越多，消耗的 API 额度越多</li>
          <li>建议设置 20-50 篇</li>
        </ul>
        <p style={{ marginTop: 8 }}><strong>Cron 表达式说明（Vercel 免费版仅支持每天一次）：</strong></p>
        <ul style={{ paddingLeft: 20 }}>
          <li><code>0 8 * * *</code> - 每天 UTC 8:00（北京时间 16:00）</li>
          <li><code>0 0 * * *</code> - 每天 UTC 0:00（北京时间 8:00）</li>
        </ul>
      </div>
    </Card>
  )
}
