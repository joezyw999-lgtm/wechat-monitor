'use client'

import { useState, useEffect } from 'react'
import { Layout, Menu } from 'antd'
import { 
  DashboardOutlined, 
  UserOutlined, 
  KeyOutlined, 
  FileTextOutlined, 
  SyncOutlined,
  SettingOutlined,
  LogoutOutlined
} from '@ant-design/icons'
import { useRouter, usePathname } from 'next/navigation'

const { Sider, Content, Header } = Layout

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [username, setUsername] = useState('')

  useEffect(() => {
    const stored = localStorage.getItem('username')
    if (!stored) {
      router.push('/login')
    } else {
      setUsername(stored)
    }
  }, [router])

  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: '仪表盘' },
    { key: '/accounts', icon: <UserOutlined />, label: '公众号管理' },
    { key: '/keywords', icon: <KeyOutlined />, label: '关键词管理' },
    { key: '/articles', icon: <FileTextOutlined />, label: '文章列表' },
    { key: '/crawl-logs', icon: <SyncOutlined />, label: '采集日志' },
    { key: '/settings', icon: <SettingOutlined />, label: '系统设置' },
  ]

  const handleLogout = () => {
    localStorage.removeItem('username')
    router.push('/login')
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed}>
        <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: collapsed ? 14 : 18, fontWeight: 'bold' }}>
          {collapsed ? '监控' : '公众号监控系统'}
        </div>
        <Menu
          theme="dark"
          selectedKeys={[pathname]}
          mode="inline"
          items={menuItems}
          onClick={({ key }) => router.push(key)}
        />
      </Sider>
      <Layout>
        <Header style={{ padding: '0 24px', background: '#fff', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <span style={{ marginRight: 16 }}>欢迎, {username}</span>
          <a onClick={handleLogout} style={{ cursor: 'pointer' }}>
            <LogoutOutlined /> 退出
          </a>
        </Header>
        <Content style={{ margin: '24px 16px', padding: 24, background: '#fff', borderRadius: 8, minHeight: 280 }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  )
}
