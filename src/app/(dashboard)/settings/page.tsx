'use client'

import { useState, useEffect, useCallback } from 'react'
import { Form, Input, InputNumber, Button, Card, message, Spin } from 'antd'

export default function SettingsPage() {
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [form] = Form.useForm()

  const [maskedOneApiKey, setMaskedOneApiKey] = useState(false)
  const [maskedLlmApiKey, setMaskedLlmApiKey] = useState(false)

  const fetchSettings = useCallback(async () => {
    setFetching(true)
    try {
      const res = await fetch('/api/settings')
      const result = await res.json()
      if (result.success) {
        const apiKey = result.data.oneapi_key || result.data.api_key || ''
        const llmApiKey = result.data.llm_api_key || ''

        const oneApiMasked = apiKey.includes('****')
        const llmKeyMasked = llmApiKey.includes('****')

        setMaskedOneApiKey(oneApiMasked)
        setMaskedLlmApiKey(llmKeyMasked)

        form.setFieldsValue({
          api_key: oneApiMasked ? '' : apiKey,
          article_count: result.data.article_count || 20,
          cron_expression: result.data.cron_expression || '0 0 * * *',
          llm_api_base: result.data.llm_api_base || '',
          llm_api_key: llmKeyMasked ? '' : llmApiKey,
          llm_model: result.data.llm_model || 'deepseek-chat',
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
      const payload: Record<string, any> = {
        cron_expression: values.cron_expression,
        article_count: values.article_count,
      }
      // Only include API key if user entered a new one
      if (values.api_key && !values.api_key.includes('****')) {
        payload.api_key = values.api_key
      }
      // LLM settings
      if (values.llm_api_base) payload.llm_api_base = values.llm_api_base
      if (values.llm_api_key && !values.llm_api_key.includes('****')) {
        payload.llm_api_key = values.llm_api_key
      }
      if (values.llm_model) payload.llm_model = values.llm_model

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const result = await res.json()
      if (result.success) {
        message.success('保存成功')
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
          rules={[{ required: !maskedOneApiKey, message: '请输入 API Key' }]}
          extra={maskedOneApiKey ? '已配置，留空则保持不变' : undefined}
        >
          <Input.Password 
            placeholder={maskedOneApiKey ? '已配置，输入新 Key 可替换' : '输入你的 getoneapi.com API Key'} 
          />
        </Form.Item>
        <Form.Item name="article_count" label="每次采集文章数量" rules={[{ required: true, message: '请输入采集数量' }]}>
          <InputNumber min={1} max={100} style={{ width: '100%' }} placeholder="默认 20" />
        </Form.Item>
        <Form.Item name="cron_expression" label="Cron 表达式" rules={[{ required: true }]}>
          <Input placeholder="0 0 * * *" />
        </Form.Item>

        <div style={{ borderTop: '1px solid #f0f0f0', margin: '24px 0' }} />

        <h3 style={{ marginBottom: 16 }}>LLM 标题清洗（可选）</h3>
        <p style={{ color: '#666', fontSize: 12, marginBottom: 16 }}>
          配置后将使用大模型对文章标题进行标准化清洗和去重，提高去重准确率。不配置则使用规则匹配。
        </p>
        <Form.Item
          name="llm_api_base"
          label="LLM API 地址"
          extra="OpenAI 兼容接口地址，如 https://api.deepseek.com/v1"
        >
          <Input placeholder="https://api.deepseek.com/v1" />
        </Form.Item>
        <Form.Item
          name="llm_api_key"
          label="LLM API Key"
          rules={maskedLlmApiKey ? [] : []}
          extra={maskedLlmApiKey ? '已配置，留空则保持不变' : undefined}
        >
          <Input.Password
            placeholder={maskedLlmApiKey ? '已配置，输入新 Key 可替换' : '输入 LLM API Key'}
          />
        </Form.Item>
        <Form.Item name="llm_model" label="模型名称">
          <Input placeholder="deepseek-chat" />
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
