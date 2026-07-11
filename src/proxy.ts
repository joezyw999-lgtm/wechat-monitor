import { NextResponse, type NextRequest } from 'next/server';

const JWT_SECRET = process.env.JWT_SECRET || 'wechat-monitor-default-secret-change-in-production';

const PUBLIC_PATHS = ['/login', '/api/auth/login'];

function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.some(p => path === p || path.startsWith(p + '/'));
}

function isApiPath(path: string): boolean {
  return path.startsWith('/api/');
}

async function verifyJWT(token: string): Promise<boolean> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    const [headerB64, payloadB64, signatureB64] = parts;

    // 用 Web Crypto API 验证签名
    const encoder = new TextEncoder();
    const keyData = encoder.encode(JWT_SECRET);

    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const data = encoder.encode(`${headerB64}.${payloadB64}`);
    const signatureBuf = base64UrlToUint8Array(signatureB64);

    const valid = await crypto.subtle.verify('HMAC', key, signatureBuf as unknown as ArrayBuffer, data);
    if (!valid) return false;

    // 检查过期时间
    const payload = JSON.parse(atob(payloadB64));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = base64.length % 4 === 0 ? 0 : 4 - (base64.length % 4);
  const padded = base64 + '='.repeat(padding);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 公共路径不校验
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get('session')?.value;

  if (!token) {
    if (isApiPath(pathname)) {
      return NextResponse.json(
        { error: '未登录' },
        { status: 401 }
      );
    }
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  const isValid = await verifyJWT(token);

  if (!isValid) {
    if (isApiPath(pathname)) {
      return NextResponse.json(
        { error: '登录已过期' },
        { status: 401 }
      );
    }
    const loginUrl = new URL('/login', request.url);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.set({
      name: 'session',
      value: '',
      expires: new Date(0),
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
    });
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public/).*)'],
};
