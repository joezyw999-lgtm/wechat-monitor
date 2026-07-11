import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'wechat-monitor-dev-secret-key-change-in-production'
);

const SESSION_COOKIE = 'wechat_session';
const SESSION_DURATION = '7d'; // 7 days

export interface SessionPayload {
  username: string;
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(JWT_SECRET);
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return { username: payload.username as string };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

export function getSessionCookieHeader(token: string): string {
  const maxAge = 7 * 24 * 60 * 60; // 7 days in seconds
  return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Secure; Max-Age=${maxAge}`;
}

export function getClearCookieHeader(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Secure; Max-Age=0`;
}

export async function requireAuth(request: Request): Promise<SessionPayload | Response> {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(/wechat_session=([^;]+)/);
  const token = match ? match[1] : '';

  if (!token) {
    return Response.json({ error: '未登录' }, { status: 401 });
  }

  const session = await verifySession(token);
  if (!session) {
    return Response.json({ error: '登录已过期' }, { status: 401 });
  }

  return session;
}
