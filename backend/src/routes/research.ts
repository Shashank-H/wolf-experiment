import { Elysia } from 'elysia';
import { env } from '../config/env';
import { completeDryRunDay, getDryRunHistory, getDryRunToday, runMorningResearchForCurrentMode } from '../services/dry-run';
import { createResearchRun, getResearchRun, listResearchRuns, subscribeToRunEvents } from '../services/research-runs';
import { addManualWatchlistItem, deleteWatchlistItem, getResearchById, getTodayResearch, getTodayWatchlist } from '../services/research';
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
    .post('/runs', async ({ body, cookie, set }) => {
      const user = await requireUser(cookie, set);
      if (!user) return { error: 'Unauthorized' };
      try {
        const input = bodyRecord(body);
        const researchType = input.researchType === 'after_open' || input.researchType === 'manual' ? input.researchType : 'pre_market';
        return await createResearchRun(user.id, {
          researchType,
          clientLocalDate: typeof input.clientLocalDate === 'string' ? input.clientLocalDate : undefined,
          clientTimeZone: typeof input.clientTimeZone === 'string' ? input.clientTimeZone : undefined,
        });
      } catch (error) {
        set.status = 400;
        return { error: error instanceof Error ? error.message : 'Research run could not start' };
      }
    })
    .get('/runs', async ({ cookie, set }) => {
      const user = await requireUser(cookie, set);
      if (!user) return { error: 'Unauthorized' };
      return { runs: await listResearchRuns(user.id) };
    })
    .get('/runs/:id', async ({ cookie, params, set }) => {
      const user = await requireUser(cookie, set);
      if (!user) return { error: 'Unauthorized' };
      const run = await getResearchRun(user.id, params.id);
      if (!run) {
        set.status = 404;
        return { error: 'Research run not found' };
      }
      return { researchRun: run };
    })
    .get('/runs/:id/events', async ({ cookie, params, request, set }) => {
      const user = await requireUser(cookie, set);
      if (!user) return { error: 'Unauthorized' };
      const stream = await subscribeToRunEvents(user.id, params.id, request.signal);
      if (!stream) {
        set.status = 404;
        return { error: 'Research run not found' };
      }
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
      });
    })
    .post('/run-morning', async ({ cookie, set }) => {
      const user = await requireUser(cookie, set);
      if (!user) return { error: 'Unauthorized' };
      try {
        return { research: await runMorningResearchForCurrentMode(user.id) };
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
  .group('/dry-run', (app) => app
    .get('/today', async ({ cookie, set }) => {
      const user = await requireUser(cookie, set);
      if (!user) return { error: 'Unauthorized' };
      return { dryRun: await getDryRunToday(user.id) };
    })
    .get('/history', async ({ cookie, set }) => {
      const user = await requireUser(cookie, set);
      if (!user) return { error: 'Unauthorized' };
      return { dryRuns: await getDryRunHistory(user.id) };
    })
    .post('/complete-eod', async ({ body, cookie, set }) => {
      const user = await requireUser(cookie, set);
      if (!user) return { error: 'Unauthorized' };
      const input = bodyRecord(body);
      const dryRun = await completeDryRunDay(user.id, typeof input.tradeDate === 'string' ? input.tradeDate : undefined);
      if (!dryRun) {
        set.status = 404;
        return { error: 'Dry run session not found' };
      }
      return { dryRun };
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
