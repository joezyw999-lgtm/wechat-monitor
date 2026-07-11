'use client'

import { useState, useEffect, useCallback } from 'react'
import { Layout, Menu, Spin } from 'antd'
import { 
  DashboardOutlined, 
  UserOutlined, 
  KeyOutlined, 
  FileTextOutlined, 
  SyncOutlined,
  SettingOutlined,
  LogoutOutlined,
  WalletOutlined
} from '@ant-design/icons'
import { useRouter, usePathname } from 'next/navigation'
import { CacheProvider } from '@/lib/cache'

const { Sider, Content, Header } = Layout

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: '仪表盘' },
  { key: '/accounts', icon: <UserOutlined />, label: '公众号管理' },
  { key: '/keywords', icon: <KeyOutlined />, label: '关键词管理' },
  { key: '/articles', icon: <FileTextOutlined />, label: '文章列表' },
  { key: '/crawl-logs', icon: <SyncOutlined />, label: '采集日志' },
  { key: '/balance', icon: <WalletOutlined />, label: '余额监控' },
  { key: '/settings', icon: <SettingOutlined />, label: '系统设置' },
]

function AppLayoutInner({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [username, setUsername] = useState('')
  const [transitioning, setTransitioning] = useState(false)

  const [checking, setChecking] = useState(true)

  useEffect(() => {
    // Verify session via API (reads HttpOnly cookie)
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setUsername(data.data.username)
        } else {
          router.push('/login')
        }
      })
      .catch(() => router.push('/login'))
      .finally(() => setChecking(false))
  }, [router])

  const handleNavigate = useCallback((key: string) => {
    if (key === pathname) return
    setTransitioning(true)
    router.push(key)
    setTimeout(() => setTransitioning(false), 300)
  }, [pathname, router])

  const handleLogout = useCallback(() => {
    fetch('/api/auth/logout', { method: 'POST' })
      .finally(() => router.push('/login'))
  }, [router])

  if (checking) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider 
        collapsible 
        collapsed={collapsed} 
        onCollapse={setCollapsed}
        width={220}
        style={{ 
          boxShadow: '2px 0 8px rgba(0,0,0,0.1)',
          zIndex: 10,
        }}
      >
        <div style={{ 
          height: 64, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          color: '#fff', 
          fontSize: collapsed ? 14 : 18, 
          fontWeight: 'bold',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}>
          {collapsed ? '监控' : '公众号监控系统'}
        </div>
        <Menu
          theme="dark"
          selectedKeys={[pathname]}
          mode="inline"
          items={menuItems}
          onClick={({ key }) => handleNavigate(key)}
          style={{ borderRight: 0 }}
        />
      </Sider>
      <Layout>
        <Header style={{ 
          padding: '0 24px', 
          background: '#fff', 
          display: 'flex', 
          justifyContent: 'flex-end', 
          alignItems: 'center',
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          zIndex: 5,
        }}>
          <span style={{ marginRight: 16, color: '#666' }}>欢迎, {username}</span>
          <a onClick={handleLogout} style={{ cursor: 'pointer', color: '#666' }}>
            <LogoutOutlined /> 退出
          </a>
        </Header>
        <Content style={{ 
          margin: '16px', 
          padding: 24, 
          background: '#fff', 
          borderRadius: 8, 
          minHeight: 280,
          position: 'relative',
          overflow: 'hidden',
        }}>
          {transitioning && (
            <div style={{ 
              position: 'absolute', 
              top: 0, 
              left: 0, 
              right: 0, 
              height: 3, 
              background: 'linear-gradient(90deg, #1890ff, #52c41a)',
              animation: 'progress 0.3s ease-in-out',
              zIndex: 100,
            }} />
          )}
          <div style={{ 
            opacity: transitioning ? 0.5 : 1,
            transition: 'opacity 0.15s ease-in-out',
          }}>
            {children}
          </div>
        </Content>
      </Layout>
      <style jsx global>{`
        @keyframes progress {
          from { transform: scaleX(0); transform-origin: left; }
          to { transform: scaleX(1); transform-origin: left; }
        }
      `}</style>
    </Layout>
  )
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <CacheProvider>
      <AppLayoutInner>{children}</AppLayoutInner>
    </CacheProvider>
  )
}
