import { eq } from 'drizzle-orm';
import { Elysia } from 'elysia';
import { env } from '../config/env';
import { db } from '../db/client';
import { tradingPreferences, userSettings, users } from '../db/schema';
import { audit } from '../utils/audit';
import { isMissingTable, isUniqueViolation, safeDatabaseMessage } from '../utils/db-errors';
import { hashPassword, verifyPassword } from '../utils/password';
import { createSession, getUserForToken, revokeSession } from '../utils/session';

type AuthBody = { email?: string; password?: string };

function normalizeCredentials(body: unknown): { email: string; password: string } {
  const input = (body ?? {}) as AuthBody;
  const email = input.email?.trim().toLowerCase();
  const password = input.password ?? '';
  if (!email || !email.includes('@')) throw new Error('Valid email is required');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  return { email, password };
}

function publicUser(user: { id: string; email: string; createdAt: Date }) {
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}

function setSessionCookie(cookie: any, token: string, expiresAt: Date) {
  cookie[env.SESSION_COOKIE_NAME].set({
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

function clearSessionCookie(cookie: any) {
  cookie[env.SESSION_COOKIE_NAME].set({
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(0),
    maxAge: 0,
  });
}

function sessionCookieValue(cookie: any): string | undefined {
  const value = cookie[env.SESSION_COOKIE_NAME]?.value;
  return typeof value === 'string' ? value : undefined;
}

export const authRoutes = new Elysia({ prefix: '/auth' })
  .post('/register', async ({ body, cookie, set }) => {
    try {
      const { email, password } = normalizeCredentials(body);
      const passwordHash = await hashPassword(password);
      const [user] = await db.insert(users).values({ email, passwordHash }).returning();
      await db.insert(userSettings).values({ userId: user.id }).onConflictDoNothing();
      await db.insert(tradingPreferences).values({ userId: user.id }).onConflictDoNothing();
      await audit('auth.register', { userId: user.id });
      const session = await createSession(user.id);
      setSessionCookie(cookie, session.token, session.expiresAt);
      set.status = 201;
      return { user: publicUser(user) };
    } catch (error) {
      if (isUniqueViolation(error, 'users_email_unique')) {
        set.status = 409;
        return { error: 'An account with this email already exists. Please log in instead.' };
      }
      if (isMissingTable(error)) {
        set.status = 503;
        return { error: safeDatabaseMessage(error) };
      }
      set.status = 400;
      return { error: error instanceof Error && !String(error.message).includes('Failed query') ? error.message : 'Registration failed' };
    }
  })
  .post('/login', async ({ body, cookie, set }) => {
    let credentials;
    try {
      credentials = normalizeCredentials(body);
    } catch (error) {
      set.status = 400;
      return { error: error instanceof Error ? error.message : 'Invalid login request' };
    }
    const { email, password } = credentials;
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      set.status = 401;
      return { error: 'Invalid email or password' };
    }
    await audit('auth.login', { userId: user.id });
    const session = await createSession(user.id);
    setSessionCookie(cookie, session.token, session.expiresAt);
    return { user: publicUser(user) };
  })
  .post('/logout', async ({ cookie }) => {
    const token = sessionCookieValue(cookie);
    const user = await getUserForToken(token);
    await revokeSession(token);
    clearSessionCookie(cookie);
    await audit('auth.logout', { userId: user?.id });
    return { ok: true };
  })
  .get('/me', async ({ cookie, set }) => {
    const user = await getUserForToken(sessionCookieValue(cookie));
    if (!user) {
      set.status = 401;
      return { user: null };
    }
    return { user: publicUser(user) };
  });
