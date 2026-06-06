import { Elysia } from 'elysia';
import { env } from '../config/env';
import { getDayBundle, getHistory, getTodayBundle } from '../services/day';
import { getUserForToken } from '../utils/session';

async function requireUser(cookie: any, set: any) {
  const user = await getUserForToken(cookie[env.SESSION_COOKIE_NAME]?.value);
  if (!user) {
    set.status = 401;
    return null;
  }
  return user;
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export const dailyRoutes = new Elysia()
  .get('/today', async ({ cookie, set }) => {
    const user = await requireUser(cookie, set);
    if (!user) return { error: 'Unauthorized' };
    return { day: await getTodayBundle(user.id) };
  })
  .group('/history', (app) => app
    .get('/', async ({ cookie, query, set }) => {
      const user = await requireUser(cookie, set);
      if (!user) return { error: 'Unauthorized' };
      const limit = Math.min(Math.max(Number(query.limit ?? 60) || 60, 1), 120);
      return { days: await getHistory(user.id, limit) };
    })
    .get('/:date', async ({ cookie, params, set }) => {
      const user = await requireUser(cookie, set);
      if (!user) return { error: 'Unauthorized' };
      if (!validDate(params.date)) {
        set.status = 400;
        return { error: 'Use history date format YYYY-MM-DD' };
      }
      return { day: await getDayBundle(user.id, params.date) };
    }));
