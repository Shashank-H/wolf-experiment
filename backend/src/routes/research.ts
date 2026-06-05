import { Elysia } from 'elysia';
import { env } from '../config/env';
import { addManualWatchlistItem, deleteWatchlistItem, getResearchById, getTodayResearch, getTodayWatchlist, runMorningResearch } from '../services/research';
import { getUserForToken } from '../utils/session';

async function requireUser(cookie: any, set: any) {
  const user = await getUserForToken(cookie[env.SESSION_COOKIE_NAME]?.value);
  if (!user) {
    set.status = 401;
    return null;
  }
  return user;
}

function bodyRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

export const researchRoutes = new Elysia()
  .group('/research', (app) => app
    .post('/run-morning', async ({ cookie, set }) => {
      const user = await requireUser(cookie, set);
      if (!user) return { error: 'Unauthorized' };
      try {
        return { research: await runMorningResearch(user.id) };
      } catch (error) {
        set.status = 400;
        return { error: error instanceof Error ? error.message : 'Morning research failed' };
      }
    })
    .get('/today', async ({ cookie, set }) => {
      const user = await requireUser(cookie, set);
      if (!user) return { error: 'Unauthorized' };
      return { research: await getTodayResearch(user.id) };
    })
    .get('/:id', async ({ cookie, params, set }) => {
      const user = await requireUser(cookie, set);
      if (!user) return { error: 'Unauthorized' };
      const research = await getResearchById(user.id, params.id);
      if (!research) {
        set.status = 404;
        return { error: 'Research session not found' };
      }
      return { research };
    }))
  .group('/watchlist', (app) => app
    .get('/today', async ({ cookie, set }) => {
      const user = await requireUser(cookie, set);
      if (!user) return { error: 'Unauthorized' };
      return { watchlist: await getTodayWatchlist(user.id) };
    })
    .post('/manual', async ({ body, cookie, set }) => {
      const user = await requireUser(cookie, set);
      if (!user) return { error: 'Unauthorized' };
      const input = bodyRecord(body);
      const tradingsymbol = typeof input.tradingsymbol === 'string' ? input.tradingsymbol.trim() : '';
      if (!tradingsymbol) {
        set.status = 400;
        return { error: 'tradingsymbol is required' };
      }
      return {
        item: await addManualWatchlistItem(user.id, {
          exchange: typeof input.exchange === 'string' ? input.exchange : undefined,
          tradingsymbol,
          reason: typeof input.reason === 'string' ? input.reason : undefined,
          bias: typeof input.bias === 'string' ? input.bias : undefined,
        }),
      };
    })
    .delete('/:id', async ({ cookie, params, set }) => {
      const user = await requireUser(cookie, set);
      if (!user) return { error: 'Unauthorized' };
      const deleted = await deleteWatchlistItem(user.id, params.id);
      if (!deleted) {
        set.status = 404;
        return { error: 'Watchlist item not found' };
      }
      return { ok: true };
    }));
