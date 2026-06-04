import { eq } from 'drizzle-orm';
import { Elysia } from 'elysia';
import { env } from '../config/env';
import { db } from '../db/client';
import { apiKeys, tradingPreferences, userSettings } from '../db/schema';
import { audit } from '../utils/audit';
import { encryptSecret } from '../utils/crypto';
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

async function upsertApiKey(userId: string, provider: string, label: string, value: unknown) {
  if (typeof value !== 'string' || value.length === 0) return;
  const encrypted = encryptSecret(value);
  await db.insert(apiKeys).values({ userId, provider, label, ...encrypted }).onConflictDoUpdate({
    target: [apiKeys.userId, apiKeys.provider, apiKeys.label],
    set: { ...encrypted, updatedAt: new Date() },
  });
  await audit('api_key.upsert', { userId, entityType: 'api_key', metadata: { provider, label } });
}

function nonNegativeInteger(input: unknown, name: string): number {
  const value = Number(input ?? 0);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function optionalUrl(input: unknown, name: string): string | undefined {
  if (typeof input !== 'string' || input.trim().length === 0) return undefined;
  try {
    const url = new URL(input.trim());
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported protocol');
    return url.toString().replace(/\/+$/, '');
  } catch {
    throw new Error(`${name} must be a valid http(s) URL`);
  }
}

export const settingsRoutes = new Elysia({ prefix: '/settings' })
  .get('/', async ({ cookie, set }) => {
    const user = await requireUser(cookie, set);
    if (!user) return { error: 'Unauthorized' };

    const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, user.id)).limit(1);
    const [preferences] = await db.select().from(tradingPreferences).where(eq(tradingPreferences.userId, user.id)).limit(1);
    const keys = await db
      .select({ provider: apiKeys.provider, label: apiKeys.label, updatedAt: apiKeys.updatedAt })
      .from(apiKeys)
      .where(eq(apiKeys.userId, user.id));

    return { settings, tradingPreferences: preferences, providerKeys: keys };
  })
  .put('/trading', async ({ body, cookie, set }) => {
    const user = await requireUser(cookie, set);
    if (!user) return { error: 'Unauthorized' };
    const input = bodyRecord(body);
    let values;
    try {
      values = {
        maxDailyLoss: nonNegativeInteger(input.maxDailyLoss, 'maxDailyLoss'),
        maxTradesPerDay: nonNegativeInteger(input.maxTradesPerDay, 'maxTradesPerDay'),
        maxCapitalPerTrade: nonNegativeInteger(input.maxCapitalPerTrade, 'maxCapitalPerTrade'),
        maxOpenPositions: nonNegativeInteger(input.maxOpenPositions, 'maxOpenPositions'),
        symbolBlacklist: Array.isArray(input.symbolBlacklist) ? input.symbolBlacklist.map(String) : [],
        strategyBlacklist: Array.isArray(input.strategyBlacklist) ? input.strategyBlacklist.map(String) : [],
        updatedAt: new Date(),
      };
    } catch (error) {
      set.status = 400;
      return { error: error instanceof Error ? error.message : 'Invalid trading preferences' };
    }
    await db.insert(tradingPreferences).values({ userId: user.id, ...values }).onConflictDoUpdate({
      target: tradingPreferences.userId,
      set: values,
    });
    await audit('settings.trading.update', { userId: user.id, metadata: values });
    return { ok: true };
  })
  .put('/providers', async ({ body, cookie, set }) => {
    const user = await requireUser(cookie, set);
    if (!user) return { error: 'Unauthorized' };
    const input = bodyRecord(body);

    await upsertApiKey(user.id, 'kite', 'api_key', input.kiteApiKey);
    await upsertApiKey(user.id, 'kite', 'api_secret', input.kiteApiSecret);
    await upsertApiKey(user.id, 'kite', 'access_token', input.kiteAccessToken);
    await upsertApiKey(user.id, 'exa', 'api_key', input.exaApiKey);
    await upsertApiKey(user.id, 'finnhub', 'api_key', input.finnhubApiKey);
    await upsertApiKey(user.id, 'llm', 'api_key', input.llmApiKey);

    let providerConfig;
    try {
      providerConfig = {
        kiteApiUrl: optionalUrl(input.kiteApiUrl, 'kiteApiUrl') ?? 'https://api.kite.trade',
        llmBaseUrl: optionalUrl(input.llmBaseUrl, 'llmBaseUrl'),
        smallModel: typeof input.smallModel === 'string' ? input.smallModel : undefined,
        mediumModel: typeof input.mediumModel === 'string' ? input.mediumModel : undefined,
        bigModel: typeof input.bigModel === 'string' ? input.bigModel : undefined,
      };
    } catch (error) {
      set.status = 400;
      return { error: error instanceof Error ? error.message : 'Invalid provider configuration' };
    }
    await db.insert(userSettings).values({ userId: user.id, providerConfig }).onConflictDoUpdate({
      target: userSettings.userId,
      set: { providerConfig, updatedAt: new Date() },
    });
    await audit('settings.providers.update', { userId: user.id, metadata: { providers: ['kite', 'exa', 'finnhub', 'llm'], kiteApiUrl: providerConfig.kiteApiUrl } });
    return { ok: true };
  })
  .put('/yolo-mode', async ({ body, cookie, set }) => {
    const user = await requireUser(cookie, set);
    if (!user) return { error: 'Unauthorized' };
    const input = bodyRecord(body);
    const enabled = Boolean(input.enabled);
    await db.insert(userSettings).values({ userId: user.id, yoloModeEnabled: enabled }).onConflictDoUpdate({
      target: userSettings.userId,
      set: { yoloModeEnabled: enabled, updatedAt: new Date() },
    });
    await audit(enabled ? 'settings.yolo.enable' : 'settings.yolo.disable', { userId: user.id });
    return { ok: true, yoloModeEnabled: enabled };
  });
