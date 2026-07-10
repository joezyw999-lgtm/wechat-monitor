'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, Statistic, Table, Tag, DatePicker, Space, Button, message, Spin, Alert, Row, Col } from 'antd'
import { WalletOutlined, ReloadOutlined, DollarOutlined, HistoryOutlined, ApiOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

const { RangePicker } = DatePicker

// API pricing map (yuan per call)
const API_PRICING: Record<string, number> = {
  '/api/wechat-mp-v2/fetch_mp_services': 0.15,
  '/api/wechat-mp-v2/fetch_mp_related_articles': 0.15,
  '/api/wechat-mp-v2/fetch_mp_article_stats': 0.15,
  '/api/wechat-mp-v2/fetch_mp_article_list': 0.15,
  '/api/wechat-mp-v2/fetch_mp_article_ad': 0.15,
  '/api/wechat-mp-v2/fetch_mp_article_comment_list': 0.15,
  '/api/wechat-mp-v2/fetch_mp_article_comment_reply_list': 0.15,
  '/api/wechat-mp-v2/fetch_mp_article_detail': 0.15,
  '/api/wechat-mp-v2/fetch_mp_profile': 0.15,
}

// Default pricing for unknown APIs
const DEFAULT_PRICING = 0.15

interface UsageRecord {
  date: string
  records: Array<{
    code: string
    successCount: number
  }>
}

interface FlattenedRecord {
  key: string
  date: string
  apiName: string
  callCount: number
  unitPrice: number
  totalCost: number
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

  const fetcherRef = useRef({ fetchBalance: null as any, fetchUsageRecords: null as any })

  const fetchBalance = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/balance?type=balance')
      const result = await res.json()
      if (result.success) {
        const balanceData = result.data
        if (typeof balanceData === 'number') {
          setBalance(balanceData)
        } else if (typeof balanceData === 'object' && balanceData !== null) {
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

  // Store latest fetchers in ref
  fetcherRef.current = { fetchBalance, fetchUsageRecords }

  useEffect(() => {
    fetcherRef.current.fetchBalance()
    fetcherRef.current.fetchUsageRecords()
  }, [fetchUsageRecords])

  const handleRefresh = () => {
    fetchBalance()
    fetchUsageRecords()
  }

  // Flatten usage records for table display
  const flattenedRecords: FlattenedRecord[] = usageRecords.flatMap((dayRecord, dayIndex) =>
    dayRecord.records.map((record, recordIndex) => {
      const unitPrice = API_PRICING[record.code] ?? DEFAULT_PRICING
      return {
        key: `${dayRecord.date}-${record.code}-${recordIndex}`,
        date: dayRecord.date,
        apiName: record.code,
        callCount: record.successCount,
        unitPrice,
        totalCost: record.successCount * unitPrice,
      }
    })
  )

  // Calculate totals
  const totalCalls = flattenedRecords.reduce((sum, r) => sum + r.callCount, 0)
  const totalCost = flattenedRecords.reduce((sum, r) => sum + r.totalCost, 0)

  // Table columns
  const columns = [
    {
      title: '日期',
      dataIndex: 'date',
      key: 'date',
      render: (v: string) => dayjs(v).format('YYYY-MM-DD'),
      sorter: (a: FlattenedRecord, b: FlattenedRecord) => a.date.localeCompare(b.date),
      defaultSortOrder: 'descend' as const,
    },
    {
      title: 'API 接口',
      dataIndex: 'apiName',
      key: 'apiName',
      render: (v: string) => {
        const shortName = v.replace('/api/wechat-mp-v2/', '')
        return <Tag icon={<ApiOutlined />} color="blue">{shortName}</Tag>
      },
    },
    {
      title: '调用次数',
      dataIndex: 'callCount',
      key: 'callCount',
      render: (v: number) => <span style={{ fontWeight: 500 }}>{v} 次</span>,
      sorter: (a: FlattenedRecord, b: FlattenedRecord) => a.callCount - b.callCount,
    },
    {
      title: '单价 (元)',
      dataIndex: 'unitPrice',
      key: 'unitPrice',
      render: (v: number) => <span style={{ color: '#666' }}>¥{v.toFixed(4)}</span>,
    },
    {
      title: '费用 (元)',
      dataIndex: 'totalCost',
      key: 'totalCost',
      render: (v: number) => <span style={{ color: '#f5222d', fontWeight: 500 }}>-¥{v.toFixed(4)}</span>,
      sorter: (a: FlattenedRecord, b: FlattenedRecord) => a.totalCost - b.totalCost,
    },
  ]

  return (
    <div>
      <Row gutter={[16, 16]}>
        {/* Balance Card */}
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="账户余额"
              value={balance ?? 0}
              precision={4}
              prefix={<WalletOutlined />}
              suffix="元"
              styles={{ content: { color: (balance ?? 0) > 10 ? '#3f8600' : (balance ?? 0) > 0 ? '#faad14' : '#cf1322' } }}
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
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="本期总消费"
              value={totalCost}
              precision={4}
              prefix={<DollarOutlined />}
              suffix="元"
              styles={{ content: { color: '#cf1322' } }}
            />
            <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
              {dateRange[0].format('MM/DD')} - {dateRange[1].format('MM/DD')}
            </div>
          </Card>
        </Col>

        {/* Call Count Card */}
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="本期调用次数"
              value={totalCalls}
              prefix={<HistoryOutlined />}
              suffix="次"
            />
            <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
              平均每次 {totalCalls > 0 ? (totalCost / totalCalls).toFixed(4) : '0.0000'} 元
            </div>
          </Card>
        </Col>

        {/* API Types Card */}
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="使用接口类型"
              value={new Set(flattenedRecords.map(r => r.apiName)).size}
              prefix={<ApiOutlined />}
              suffix="种"
            />
            <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
              单价均为 ¥0.15/次
            </div>
          </Card>
        </Col>
      </Row>

      {/* Usage Records */}
      <Card
        title="使用记录明细"
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
          dataSource={flattenedRecords}
          loading={usageLoading}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条记录`
          }}
          locale={{ emptyText: '暂无使用记录' }}
          summary={() => (
            <Table.Summary fixed>
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={2}>
                  <strong>合计</strong>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1}>
                  <strong>{totalCalls} 次</strong>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2}>-</Table.Summary.Cell>
                <Table.Summary.Cell index={3}>
                  <strong style={{ color: '#f5222d' }}>-¥{totalCost.toFixed(4)}</strong>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />
      </Card>

      {/* Info */}
      <Alert
        message="计费说明"
        description={
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>公众号相关接口（wechat-mp-v2）单价：<strong>¥0.15/次</strong></li>
            <li>仅成功的请求（code=200）才会计费，失败不扣费</li>
            <li>余额数据实时同步自 getoneapi.com</li>
            <li>使用记录最多可查询 31 天范围内的数据</li>
            <li>当前余额：¥{balance?.toFixed(4) ?? '0.0000'}，预计可支撑约 {balance && totalCost > 0 ? Math.floor(balance / (totalCost / dayjs(dateRange[1]).diff(dayjs(dateRange[0]), 'day') || 1)).toFixed(0) : '-'} 天</li>
          </ul>
        }
        type="info"
        showIcon
        style={{ marginTop: 16 }}
      />
    </div>
  )
}
