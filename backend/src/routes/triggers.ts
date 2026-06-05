import { Elysia } from 'elysia';
import { env } from '../config/env';
import { cancelTrigger, createTrigger, decideApproval, listTriggers, pendingApprovals, updateTrigger } from '../services/triggers';
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

export const triggerRoutes = new Elysia()
  .group('/triggers', (app) => app
    .get('/', async ({ cookie, set }) => {
      const user = await requireUser(cookie, set);
      if (!user) return { error: 'Unauthorized' };
      return { triggers: await listTriggers(user.id) };
    })
    .post('/', async ({ body, cookie, set }) => {
      const user = await requireUser(cookie, set);
      if (!user) return { error: 'Unauthorized' };
      try {
        return await createTrigger(user.id, bodyRecord(body) as { rule: unknown; orderDraft: unknown });
      } catch (error) {
        set.status = 400;
        return { error: error instanceof Error ? error.message : 'Could not create trigger' };
      }
    })
    .put('/:id', async ({ body, cookie, params, set }) => {
      const user = await requireUser(cookie, set);
      if (!user) return { error: 'Unauthorized' };
      try {
        const trigger = await updateTrigger(user.id, params.id, bodyRecord(body));
        if (!trigger) {
          set.status = 404;
          return { error: 'Trigger not found' };
        }
        return { trigger };
      } catch (error) {
        set.status = 400;
        return { error: error instanceof Error ? error.message : 'Could not update trigger' };
      }
    })
    .post('/:id/cancel', async ({ cookie, params, set }) => {
      const user = await requireUser(cookie, set);
      if (!user) return { error: 'Unauthorized' };
      const trigger = await cancelTrigger(user.id, params.id);
      if (!trigger) {
        set.status = 404;
        return { error: 'Trigger not found' };
      }
      return { trigger };
    }))
  .group('/approvals', (app) => app
    .get('/pending', async ({ cookie, set }) => {
      const user = await requireUser(cookie, set);
      if (!user) return { error: 'Unauthorized' };
      return { approvals: await pendingApprovals(user.id) };
    })
    .post('/:id/approve', async ({ body, cookie, params, set }) => {
      const user = await requireUser(cookie, set);
      if (!user) return { error: 'Unauthorized' };
      const input = bodyRecord(body);
      const approval = await decideApproval(user.id, params.id, 'approved', typeof input.note === 'string' ? input.note : undefined);
      if (!approval) {
        set.status = 404;
        return { error: 'Pending approval not found' };
      }
      return { approval };
    })
    .post('/:id/reject', async ({ body, cookie, params, set }) => {
      const user = await requireUser(cookie, set);
      if (!user) return { error: 'Unauthorized' };
      const input = bodyRecord(body);
      const approval = await decideApproval(user.id, params.id, 'rejected', typeof input.note === 'string' ? input.note : undefined);
      if (!approval) {
        set.status = 404;
        return { error: 'Pending approval not found' };
      }
      return { approval };
    }));
