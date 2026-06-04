import { desc, eq } from 'drizzle-orm';
import { Elysia } from 'elysia';
import { env } from '../config/env';
import { db } from '../db/client';
import { apiKeys, orderEvents, orders, userSettings } from '../db/schema';
import { KiteBrokerAdapter } from '../providers/broker/KiteBrokerAdapter';
import { audit } from '../utils/audit';
import { decryptSecret } from '../utils/crypto';
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

async function kiteAdapterForUser(userId: string): Promise<KiteBrokerAdapter | null> {
  const [keys, settingsRows] = await Promise.all([
    db.select().from(apiKeys).where(eq(apiKeys.userId, userId)),
    db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1),
  ]);
  const byLabel = new Map(keys.filter((key) => key.provider === 'kite').map((key) => [key.label, key]));
  const apiKey = byLabel.get('api_key');
  const accessToken = byLabel.get('access_token');
  const apiUrl = typeof settingsRows[0]?.providerConfig?.kiteApiUrl === 'string' ? settingsRows[0].providerConfig.kiteApiUrl : undefined;
  if (!apiKey || !accessToken) return null;
  return new KiteBrokerAdapter({ apiKey: decryptSecret(apiKey), accessToken: decryptSecret(accessToken), apiUrl });
}

export const orderRoutes = new Elysia({ prefix: '/orders' })
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
      const adapter = await kiteAdapterForUser(user.id);
      if (!adapter) {
        set.status = 400;
        return { error: 'Kite API key and access token are required before broker cancellation can be submitted' };
      }
      await adapter.cancelOrder({ orderId: order.brokerOrderId });
    }
    const [updated] = await db.update(orders).set({ status: 'cancel_requested', updatedAt: new Date() }).where(eq(orders.id, order.id)).returning();
    await db.insert(orderEvents).values({ userId: user.id, orderId: order.id, eventType: 'cancel_requested', brokerStatus: order.status, message: order.brokerOrderId ? 'Cancel submitted to Kite by user' : 'Internal cancel requested by user' });
    await audit('order.cancel.request', { userId: user.id, entityType: 'order', entityId: order.id, metadata: { brokerOrderId: order.brokerOrderId, submittedToBroker: Boolean(order.brokerOrderId) } });
    return { order: updated };
  });
