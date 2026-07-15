'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Layout, Menu } from 'antd'
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

// 常用页面列表（用于 prefetch）
const FREQUENT_PATHS = ['/', '/accounts', '/articles', '/crawl-logs']

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: '数据监控' },
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
  // 顶部进度条状态：none / loading / done
  const [progressState, setProgressState] = useState<'none' | 'loading' | 'done'>('none')
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 进度条：点击菜单立即显示 loading，路由切换完成后 done → 消失
  const startProgress = useCallback(() => {
    if (progressTimerRef.current) clearTimeout(progressTimerRef.current)
    setProgressState('loading')
  }, [])

  const finishProgress = useCallback(() => {
    setProgressState('done')
    if (progressTimerRef.current) clearTimeout(progressTimerRef.current)
    progressTimerRef.current = setTimeout(() => {
      setProgressState('none')
    }, 200)
  }, [])

  // 页面首次挂载后预加载常用路由
  useEffect(() => {
    // 延迟一帧再 prefetch，避免影响首屏
    const timer = setTimeout(() => {
      FREQUENT_PATHS.forEach(path => {
        if (path !== pathname) {
          router.prefetch(path)
        }
      })
    }, 300)
    return () => clearTimeout(timer)
  }, [router, pathname])

  // 菜单点击导航
  const handleNavigate = useCallback((key: string) => {
    if (key === pathname) return
    startProgress()
    router.push(key)
  }, [pathname, router, startProgress])

  // 菜单项鼠标悬停时预加载
  const handleMenuHover = useCallback((key: string) => {
    if (key !== pathname) {
      router.prefetch(key)
    }
  }, [pathname, router])

  // 退出登录
  const handleLogout = useCallback(() => {
    fetch('/api/auth/logout', { method: 'POST' })
      .finally(() => router.push('/login'))
  }, [router])

  // 监听 pathname 变化，路由切换完成后结束进度条
  useEffect(() => {
    if (progressState === 'loading') {
      finishProgress()
    }
  }, [pathname, progressState, finishProgress])

  // 用 memo 固定 menu items 的 onMouseEnter 绑定
  const menuItemsWithHover = useMemo(
    () =>
      menuItems.map(item => ({
        ...item,
        onMouseEnter: () => handleMenuHover(item.key),
      })),
    [handleMenuHover]
  )

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* 顶部进度条 */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          zIndex: 9999,
          pointerEvents: 'none',
          background: 'transparent',
        }}
      >
        <div
          style={{
            height: '100%',
            background: '#1677ff',
            transformOrigin: 'left',
            transform: progressState === 'loading' ? 'scaleX(0.75)' : progressState === 'done' ? 'scaleX(1)' : 'scaleX(0)',
            opacity: progressState === 'none' ? 0 : 1,
            transition: progressState === 'loading'
              ? 'transform 0.4s ease-out, opacity 0.2s'
              : 'transform 0.2s ease-out, opacity 0.2s',
            boxShadow: '0 0 6px rgba(22, 119, 255, 0.6)',
          }}
        />
      </div>

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
          items={menuItemsWithHover}
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
        }}>
          {children}
        </Content>
      </Layout>
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
