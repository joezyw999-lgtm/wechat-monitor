import { NextResponse, type NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'wechat-monitor-dev-secret-key-change-in-production'
)

const SESSION_COOKIE = 'wechat_session'

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/cron/crawl']

function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.some(p => path === p || path.startsWith(p + '/'))
}

function isApiPath(path: string): boolean {
  return path.startsWith('/api/')
}

async function verifyJWT(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, JWT_SECRET)
    return true
  } catch {
    return false
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value

  if (!token) {
    if (isApiPath(pathname)) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const isValid = await verifyJWT(token)

  if (!isValid) {
    if (isApiPath(pathname)) {
      return NextResponse.json({ error: '登录已过期' }, { status: 401 })
    }

    const response = NextResponse.redirect(new URL('/login', request.url))
    response.cookies.set({
      name: SESSION_COOKIE,
      value: '',
      expires: new Date(0),
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
    })
    return response
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public/).*)'],
}
