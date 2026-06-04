import { Elysia } from 'elysia';
import { checkDatabase } from '../db/client';

export const healthRoutes = new Elysia()
  .get('/health', () => ({ status: 'ok' as const }))
  .get('/ready', async ({ set }) => {
    const database = await checkDatabase();
    if (!database) set.status = 503;
    return { status: database ? 'ready' : 'not_ready', checks: { database } };
  });
