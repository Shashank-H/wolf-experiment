import { Elysia } from 'elysia';
import { env } from '../config/env';
import { approveGttCandidate, cancelGtt, listGttState, rejectGttCandidate } from '../services/execution';
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

export const gttRoutes = new Elysia({ prefix: '/gtt' })
  .get('/', async ({ cookie, set }) => {
    const user = await requireUser(cookie, set);
    if (!user) return { error: 'Unauthorized' };
    return await listGttState(user.id);
  })
  .post('/:id/approve', async ({ cookie, params, set }) => {
    const user = await requireUser(cookie, set);
    if (!user) return { error: 'Unauthorized' };
    try {
      const result = await approveGttCandidate(user.id, params.id);
      if (!result) {
        set.status = 404;
        return { error: 'GTT candidate not found' };
      }
      return result;
    } catch (error) {
      set.status = 400;
      return { error: error instanceof Error ? error.message : 'Could not approve GTT' };
    }
  })
  .post('/:id/reject', async ({ body, cookie, params, set }) => {
    const user = await requireUser(cookie, set);
    if (!user) return { error: 'Unauthorized' };
    const input = bodyRecord(body);
    const candidate = await rejectGttCandidate(user.id, params.id, typeof input.note === 'string' ? input.note : undefined);
    if (!candidate) {
      set.status = 404;
      return { error: 'GTT candidate not found' };
    }
    return { candidate };
  })
  .post('/:id/cancel', async ({ cookie, params, set }) => {
    const user = await requireUser(cookie, set);
    if (!user) return { error: 'Unauthorized' };
    try {
      const gttOrder = await cancelGtt(user.id, params.id);
      if (!gttOrder) {
        set.status = 404;
        return { error: 'GTT order not found' };
      }
      return { gttOrder };
    } catch (error) {
      set.status = 400;
      return { error: error instanceof Error ? error.message : 'Could not cancel GTT' };
    }
  });
