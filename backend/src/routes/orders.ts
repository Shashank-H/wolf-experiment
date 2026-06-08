import { desc, eq } from 'drizzle-orm';
import { Elysia } from 'elysia';
import { env } from '../config/env';
import { db } from '../db/client';
import { orderEvents, orders } from '../db/schema';
import { syncOrders } from '../services/broker-sync';
import { TRADING_SAFETY_INVARIANT } from '../trading-safety';
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

const cancellableStatuses = new Set(['created', 'risk_validated', 'pending_approval', 'approved', 'submitted', 'open']);

export const orderRoutes = new Elysia({ prefix: '/orders' })
  .post('/sync', async ({ cookie, set }) => {
    const user = await requireUser(cookie, set);
    if (!user) return { error: 'Unauthorized' };
    try {
      const result = await syncOrders(user.id);
      if (!result.ok) {
        set.status = 400;
        return { error: 'Kite login is required before order sync', sync: result };
      }
      await audit('orders.sync.manual', { userId: user.id, metadata: result });
      return { sync: result };
    } catch (error) {
      set.status = 400;
      return { error: error instanceof Error ? `Kite order sync failed: ${error.message}` : 'Kite order sync failed' };
    }
  })
  .get('/', async ({ cookie, set }) => {
    const user = await requireUser(cookie, set);
    if (!user) return { error: 'Unauthorized' };
    const rows = await db.select().from(orders).where(eq(orders.userId, user.id)).orderBy(desc(orders.createdAt));
    return { orders: rows };
  })
  .get('/:id', async ({ params, cookie, set }) => {
    const user = await requireUser(cookie, set);
    if (!user) return { error: 'Unauthorized' };
    const [order] = await db.select().from(orders).where(eq(orders.id, params.id)).limit(1);
    if (!order || order.userId !== user.id) {
      set.status = 404;
      return { error: 'Order not found' };
    }
    const events = await db.select().from(orderEvents).where(eq(orderEvents.orderId, order.id)).orderBy(desc(orderEvents.createdAt));
    return { order, events };
  })
  .post('/:id/cancel', async ({ params, cookie, set }) => {
    const user = await requireUser(cookie, set);
    if (!user) return { error: 'Unauthorized' };
    const [order] = await db.select().from(orders).where(eq(orders.id, params.id)).limit(1);
    if (!order || order.userId !== user.id) {
      set.status = 404;
      return { error: 'Order not found' };
    }
    if (!cancellableStatuses.has(order.status)) {
      set.status = 400;
      return { error: `Order status ${order.status} cannot be cancelled` };
    }
    if (order.brokerOrderId) {
      set.status = 400;
      return { error: TRADING_SAFETY_INVARIANT };
    }
    const [updated] = await db.update(orders).set({ status: 'cancel_requested', updatedAt: new Date() }).where(eq(orders.id, order.id)).returning();
    await db.insert(orderEvents).values({ userId: user.id, orderId: order.id, eventType: 'cancel_requested', brokerStatus: order.status, message: 'Internal cancel requested by user; no broker regular order API call was made' });
    await audit('order.cancel.request', { userId: user.id, entityType: 'order', entityId: order.id, metadata: { brokerOrderId: order.brokerOrderId, submittedToBroker: false, safetyInvariant: true } });
    return { order: updated };
  });
