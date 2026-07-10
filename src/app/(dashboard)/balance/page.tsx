'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, Statistic, Table, Tag, DatePicker, Space, Button, message, Spin, Alert, Row, Col } from 'antd'
import { WalletOutlined, ReloadOutlined, DollarOutlined, HistoryOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

const { RangePicker } = DatePicker

interface UsageRecord {
  id?: string
  date?: string
  created_at?: string
  api_name?: string
  api_type?: string
  cost?: number
  balance?: number
  status?: string
  [key: string]: any
}

export default function BalancePage() {
  const [loading, setLoading] = useState(false)
  const [balance, setBalance] = useState<number | null>(null)
  const [usageRecords, setUsageRecords] = useState<UsageRecord[]>([])
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(30, 'day'),
    dayjs()
  ])
  const [usageLoading, setUsageLoading] = useState(false)

  const fetchBalance = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/balance?type=balance')
      const result = await res.json()
      if (result.success) {
        // The balance data structure may vary, try to extract the balance value
        const balanceData = result.data
        if (typeof balanceData === 'number') {
          setBalance(balanceData)
        } else if (typeof balanceData === 'object' && balanceData !== null) {
          // Try common field names
          const balanceValue = balanceData.balance ?? balanceData.amount ?? balanceData.remaining ?? balanceData.credit ?? null
          setBalance(typeof balanceValue === 'number' ? balanceValue : parseFloat(balanceValue) || 0)
        } else {
          setBalance(0)
        }
      } else {
        message.error(result.message || '获取余额失败')
      }
    } catch (error) {
      console.error(error)
      message.error('获取余额失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchUsageRecords = useCallback(async () => {
    setUsageLoading(true)
    try {
      const startDate = dateRange[0].format('YYYY-MM-DD')
      const endDate = dateRange[1].format('YYYY-MM-DD')
      const res = await fetch(`/api/balance?type=usage&startDate=${startDate}&endDate=${endDate}`)
      const result = await res.json()
      if (result.success) {
        setUsageRecords(result.data || [])
      } else {
        message.error(result.message || '获取使用记录失败')
      }
    } catch (error) {
      console.error(error)
      message.error('获取使用记录失败')
    } finally {
      setUsageLoading(false)
    }
  }, [dateRange])

  useEffect(() => {
    fetchBalance()
    fetchUsageRecords()
  }, [fetchBalance, fetchUsageRecords])

  const handleRefresh = () => {
    fetchBalance()
    fetchUsageRecords()
  }

  // Calculate total cost from usage records
  const totalCost = usageRecords.reduce((sum, record) => {
    const cost = record.cost ?? record.amount ?? record.fee ?? 0
    return sum + (typeof cost === 'number' ? cost : parseFloat(cost) || 0)
  }, 0)

  // Table columns for usage records
  const columns = [
    {
      title: '日期',
      dataIndex: 'date',
      key: 'date',
      render: (v: string, record: UsageRecord) => {
        const date = v || record.created_at
        return date ? dayjs(date).format('YYYY-MM-DD HH:mm') : '-'
      }
    },
    {
      title: 'API 名称',
      key: 'api_name',
      render: (_: any, record: UsageRecord) => {
        return record.api_name || record.api_type || record.name || record.endpoint || '-'
      }
    },
    {
      title: '费用 (元)',
      dataIndex: 'cost',
      key: 'cost',
      render: (v: number, record: UsageRecord) => {
        const cost = v ?? record.amount ?? record.fee ?? 0
        const costNum = typeof cost === 'number' ? cost : parseFloat(cost) || 0
        return <span style={{ color: '#f5222d' }}>-{costNum.toFixed(4)}</span>
      }
    },
    {
      title: '剩余余额 (元)',
      dataIndex: 'balance',
      key: 'balance',
      render: (v: number, record: UsageRecord) => {
        const bal = v ?? record.remaining ?? record.credit_after
        if (bal === undefined || bal === null) return '-'
        const balNum = typeof bal === 'number' ? bal : parseFloat(bal) || 0
        return <span style={{ color: '#52c41a' }}>{balNum.toFixed(4)}</span>
      }
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (v: string) => {
        if (!v) return <Tag color="green">成功</Tag>
        const statusMap: Record<string, { color: string; text: string }> = {
          success: { color: 'green', text: '成功' },
          failed: { color: 'red', text: '失败' },
          pending: { color: 'orange', text: '处理中' },
        }
        const status = statusMap[v.toLowerCase()] || { color: 'default', text: v }
        return <Tag color={status.color}>{status.text}</Tag>
      }
    }
  ]

  return (
    <div>
      <Row gutter={[16, 16]}>
        {/* Balance Card */}
        <Col xs={24} sm={12} lg={8}>
          <Card>
            <Statistic
              title="账户余额"
              value={balance ?? 0}
              precision={4}
              prefix={<WalletOutlined />}
              suffix="元"
              valueStyle={{ color: (balance ?? 0) > 10 ? '#3f8600' : (balance ?? 0) > 0 ? '#faad14' : '#cf1322' }}
            />
            {balance !== null && balance <= 10 && (
              <Alert
                message="余额不足"
                description="当前余额较低，请及时充值以确保服务正常运行"
                type="warning"
                showIcon
                style={{ marginTop: 16 }}
              />
            )}
          </Card>
        </Col>

        {/* Total Cost Card */}
        <Col xs={24} sm={12} lg={8}>
          <Card>
            <Statistic
              title="本期总消费"
              value={totalCost}
              precision={4}
              prefix={<DollarOutlined />}
              suffix="元"
              valueStyle={{ color: '#cf1322' }}
            />
            <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
              {dateRange[0].format('MM/DD')} - {dateRange[1].format('MM/DD')}
            </div>
          </Card>
        </Col>

        {/* Record Count Card */}
        <Col xs={24} sm={12} lg={8}>
          <Card>
            <Statistic
              title="本期调用次数"
              value={usageRecords.length}
              prefix={<HistoryOutlined />}
              suffix="次"
            />
            <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
              平均每次 {(usageRecords.length > 0 ? totalCost / usageRecords.length : 0).toFixed(4)} 元
            </div>
          </Card>
        </Col>
      </Row>

      {/* Usage Records */}
      <Card
        title="使用记录"
        style={{ marginTop: 16 }}
        extra={
          <Space>
            <RangePicker
              value={dateRange}
              onChange={(dates) => {
                if (dates && dates[0] && dates[1]) {
                  setDateRange([dates[0], dates[1]])
                }
              }}
              disabledDate={(current) => current && current > dayjs().endOf('day')}
              allowClear={false}
            />
            <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={loading || usageLoading}>
              刷新
            </Button>
          </Space>
        }
      >
        <Table
          columns={columns}
          dataSource={usageRecords}
          rowKey={(record, index) => record.id || record.date || String(index)}
          loading={usageLoading}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条记录`
          }}
          locale={{ emptyText: '暂无使用记录' }}
        />
      </Card>

      {/* Info */}
      <Alert
        message="计费说明"
        description={
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>每次 API 调用会根据接口类型扣除相应费用</li>
            <li>只有成功的请求（code=200）才会计费</li>
            <li>失败的请求不会扣费，可以安全重试</li>
            <li>余额数据实时同步自 getoneapi.com</li>
            <li>使用记录最多可查询 31 天范围内的数据</li>
          </ul>
        }
        type="info"
        showIcon
        style={{ marginTop: 16 }}
      />
    </div>
  )
}
