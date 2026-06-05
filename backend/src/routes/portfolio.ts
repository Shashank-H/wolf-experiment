import { desc, eq } from 'drizzle-orm';
import { Elysia } from 'elysia';
import { env } from '../config/env';
import { db } from '../db/client';
import { holdingsSnapshots, positions } from '../db/schema';
import { syncPortfolio } from '../services/broker-sync';
import { audit } from '../utils/audit';
import { getUserForToken } from '../utils/session';

async function requireUser(cookie: any, set: any) {
  const user = await getUserForToken(cookie[env.SESSION_COOKIE_NAME]?.value);
  if (!user) {
    set.status = 401;
    return null;
  }
  return user;
}

function latestBySymbol<T extends { exchange: string; tradingsymbol: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.exchange}:${row.tradingsymbol}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function numberValue(value: unknown): number {
  return Number(value ?? 0);
}

export const portfolioRoutes = new Elysia({ prefix: '/portfolio' })
  .post('/sync', async ({ cookie, set }) => {
    const user = await requireUser(cookie, set);
    if (!user) return { error: 'Unauthorized' };
    try {
      const result = await syncPortfolio(user.id);
      if (!result.ok) {
        set.status = 400;
        return { error: 'Kite login is required before portfolio sync', sync: result };
      }
      await audit('portfolio.sync.manual', { userId: user.id, metadata: result });
      return { sync: result };
    } catch (error) {
      set.status = 400;
      return { error: error instanceof Error ? `Kite portfolio sync failed: ${error.message}` : 'Kite portfolio sync failed' };
    }
  })
  .get('/holdings', async ({ cookie, set }) => {
    const user = await requireUser(cookie, set);
    if (!user) return { error: 'Unauthorized' };
    const rows = await db.select().from(holdingsSnapshots).where(eq(holdingsSnapshots.userId, user.id)).orderBy(desc(holdingsSnapshots.capturedAt));
    return { holdings: latestBySymbol(rows) };
  })
  .get('/positions', async ({ cookie, set }) => {
    const user = await requireUser(cookie, set);
    if (!user) return { error: 'Unauthorized' };
    const rows = await db.select().from(positions).where(eq(positions.userId, user.id)).orderBy(desc(positions.lastSyncedAt));
    return { positions: rows };
  })
  .get('/pnl', async ({ cookie, set }) => {
    const user = await requireUser(cookie, set);
    if (!user) return { error: 'Unauthorized' };
    const holdingRows = latestBySymbol(await db.select().from(holdingsSnapshots).where(eq(holdingsSnapshots.userId, user.id)).orderBy(desc(holdingsSnapshots.capturedAt)));
    const positionRows = await db.select().from(positions).where(eq(positions.userId, user.id));
    const holdingsPnl = holdingRows.reduce((sum, row) => sum + numberValue(row.pnl), 0);
    const positionsPnl = positionRows.reduce((sum, row) => sum + numberValue(row.pnl), 0);
    return {
      pnl: {
        holdingsPnl,
        positionsPnl,
        totalPnl: holdingsPnl + positionsPnl,
        holdingsCount: holdingRows.length,
        positionsCount: positionRows.length,
      },
    };
  });
