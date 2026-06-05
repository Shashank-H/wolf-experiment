import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Elysia } from 'elysia';
import { env } from '../config/env';
import { db } from '../db/client';
import { apiKeys, brokerAccounts, tradingPreferences, userSettings } from '../db/schema';
import { KiteBrokerAdapter } from '../providers/broker/KiteBrokerAdapter';
import { DEFAULT_MORNING_RESEARCH_SETTINGS } from '../prompts/morning-research';
import type { ResearchRiskTolerance } from '../prompts/morning-research';
import { refreshKiteBrokerAccount, syncOrders, syncPortfolio } from '../services/broker-sync';
import { audit } from '../utils/audit';
import { decryptSecret, encryptSecret } from '../utils/crypto';
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
  if (typeof value !== 'string' || value.trim().length === 0) return;
  const encrypted = encryptSecret(value.trim());
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

function integerInRange(input: unknown, name: string, min: number, max: number): number {
  const value = Number(input);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

function riskTolerance(input: unknown): ResearchRiskTolerance {
  return input === 'moderate' || input === 'aggressive' ? input : 'conservative';
}

async function getApiSecret(userId: string, provider: string, label: string): Promise<string | null> {
  const [key] = await db.select().from(apiKeys).where(and(eq(apiKeys.userId, userId), eq(apiKeys.provider, provider), eq(apiKeys.label, label))).limit(1);
  return key ? decryptSecret(key) : null;
}

function estimatedKiteTokenExpiry(now = new Date()): Date {
  // Kite access tokens are not refreshable and normally expire at Zerodha's daily reset.
  // Use 07:30 IST as a conservative display estimate; logging in just after reset maximizes validity.
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffsetMs);
  const expiryIst = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 7, 30, 0, 0));
  if (istNow.getUTCHours() > 7 || (istNow.getUTCHours() === 7 && istNow.getUTCMinutes() >= 30)) {
    expiryIst.setUTCDate(expiryIst.getUTCDate() + 1);
  }
  return new Date(expiryIst.getTime() - istOffsetMs);
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
    const [kiteAccount] = await db.select({
      id: brokerAccounts.id,
      broker: brokerAccounts.broker,
      brokerUserId: brokerAccounts.brokerUserId,
      displayName: brokerAccounts.displayName,
      status: brokerAccounts.status,
      accessTokenExpiresAt: brokerAccounts.accessTokenExpiresAt,
      lastSyncedAt: brokerAccounts.lastSyncedAt,
      updatedAt: brokerAccounts.updatedAt,
    }).from(brokerAccounts).where(eq(brokerAccounts.userId, user.id)).limit(1);

    const brokerAccount = kiteAccount
      ? { ...kiteAccount, status: kiteAccount.accessTokenExpiresAt && kiteAccount.accessTokenExpiresAt.getTime() <= Date.now() ? 'expired' : kiteAccount.status }
      : null;
    return { settings, tradingPreferences: preferences, providerKeys: keys.filter((key) => key.label !== 'login_state'), brokerAccount };
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
  .put('/research', async ({ body, cookie, set }) => {
    const user = await requireUser(cookie, set);
    if (!user) return { error: 'Unauthorized' };
    const input = bodyRecord(body);
    let researchConfig;
    try {
      researchConfig = {
        maxWatchlistItems: integerInRange(input.maxWatchlistItems ?? DEFAULT_MORNING_RESEARCH_SETTINGS.maxWatchlistItems, 'maxWatchlistItems', 0, 24),
        maxTradeCandidates: integerInRange(input.maxTradeCandidates ?? DEFAULT_MORNING_RESEARCH_SETTINGS.maxTradeCandidates, 'maxTradeCandidates', 0, 12),
        maxGttCandidates: integerInRange(input.maxGttCandidates ?? DEFAULT_MORNING_RESEARCH_SETTINGS.maxGttCandidates, 'maxGttCandidates', 0, 12),
        riskTolerance: riskTolerance(input.riskTolerance),
      };
    } catch (error) {
      set.status = 400;
      return { error: error instanceof Error ? error.message : 'Invalid research settings' };
    }
    const [existing] = await db.select().from(userSettings).where(eq(userSettings.userId, user.id)).limit(1);
    const providerConfig = { ...(existing?.providerConfig ?? {}), ...researchConfig };
    await db.insert(userSettings).values({ userId: user.id, providerConfig }).onConflictDoUpdate({
      target: userSettings.userId,
      set: { providerConfig, updatedAt: new Date() },
    });
    await audit('settings.research.update', { userId: user.id, metadata: researchConfig });
    return { ok: true, researchConfig };
  })
  .put('/providers', async ({ body, cookie, set }) => {
    const user = await requireUser(cookie, set);
    if (!user) return { error: 'Unauthorized' };
    const input = bodyRecord(body);

    await upsertApiKey(user.id, 'kite', 'api_key', input.kiteApiKey);
    await upsertApiKey(user.id, 'kite', 'api_secret', input.kiteApiSecret);
    await upsertApiKey(user.id, 'exa', 'api_key', input.exaApiKey);
    await upsertApiKey(user.id, 'finnhub', 'api_key', input.finnhubApiKey);
    await upsertApiKey(user.id, 'llm', 'api_key', input.llmApiKey);

    let providerConfig;
    try {
      const [existing] = await db.select().from(userSettings).where(eq(userSettings.userId, user.id)).limit(1);
      providerConfig = {
        ...(existing?.providerConfig ?? {}),
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
  .get('/kite/login-url', async ({ cookie, set }) => {
    const user = await requireUser(cookie, set);
    if (!user) return { error: 'Unauthorized' };
    const [apiKey, apiSecret] = await Promise.all([
      getApiSecret(user.id, 'kite', 'api_key'),
      getApiSecret(user.id, 'kite', 'api_secret'),
    ]);
    if (!apiKey || !apiSecret) {
      set.status = 400;
      return { error: 'Save your Kite API key and API secret first' };
    }
    const loginState = randomBytes(24).toString('base64url');
    await upsertApiKey(user.id, 'kite', 'login_state', loginState);
    return {
      loginUrl: KiteBrokerAdapter.loginUrl(apiKey),
      loginState,
      tokenExpiryNote: 'Kite access tokens are not refreshable. Login just after Zerodha daily reset (~07:30 IST) for the longest same-day validity.',
      estimatedExpiresAt: estimatedKiteTokenExpiry().toISOString(),
    };
  })
  .post('/kite/session', async ({ body, cookie, set }) => {
    const user = await requireUser(cookie, set);
    if (!user) return { error: 'Unauthorized' };
    const input = bodyRecord(body);
    const requestToken = typeof input.requestToken === 'string' ? input.requestToken.trim() : '';
    const loginState = typeof input.loginState === 'string' ? input.loginState.trim() : '';
    if (!requestToken || !loginState) {
      set.status = 400;
      return { error: 'requestToken and loginState are required' };
    }

    const [apiKey, apiSecret, expectedLoginState, settings] = await Promise.all([
      getApiSecret(user.id, 'kite', 'api_key'),
      getApiSecret(user.id, 'kite', 'api_secret'),
      getApiSecret(user.id, 'kite', 'login_state'),
      db.select().from(userSettings).where(eq(userSettings.userId, user.id)).limit(1),
    ]);
    if (!apiKey || !apiSecret) {
      set.status = 400;
      return { error: 'Save your Kite API key and API secret first' };
    }
    if (!expectedLoginState || expectedLoginState !== loginState) {
      set.status = 400;
      return { error: 'Kite login state is missing or expired. Start Kite login again.' };
    }
    const apiUrl = typeof settings[0]?.providerConfig?.kiteApiUrl === 'string' ? settings[0].providerConfig.kiteApiUrl : undefined;
    try {
      const session = await KiteBrokerAdapter.generateSession({ apiKey, apiSecret, requestToken, apiUrl });
      await upsertApiKey(user.id, 'kite', 'access_token', session.accessToken);
      const estimatedExpiresAt = estimatedKiteTokenExpiry();
      const safeSession = {
        user_id: session.userId,
        user_name: session.userName,
        email: session.email,
        avatar_url: session.avatarUrl,
      };
      const [account] = await db.insert(brokerAccounts).values({
        userId: user.id,
        broker: 'kite',
        brokerUserId: session.userId,
        displayName: session.userName ?? session.email ?? session.userId,
        status: 'connected',
        accessTokenExpiresAt: estimatedExpiresAt,
        metadata: {
          session: safeSession,
          tokenPolicy: 'Kite access tokens expire at daily reset and cannot be refreshed by API.',
        },
      }).onConflictDoUpdate({
        target: [brokerAccounts.userId, brokerAccounts.broker],
        set: {
          brokerUserId: session.userId,
          displayName: session.userName ?? session.email ?? session.userId,
          status: 'connected',
          accessTokenExpiresAt: estimatedExpiresAt,
          metadata: {
            session: safeSession,
            tokenPolicy: 'Kite access tokens expire at daily reset and cannot be refreshed by API.',
          },
          updatedAt: new Date(),
        },
      }).returning();
      await db.delete(apiKeys).where(and(eq(apiKeys.userId, user.id), eq(apiKeys.provider, 'kite'), eq(apiKeys.label, 'login_state')));
      await refreshKiteBrokerAccount(user.id).catch(() => null);
      await audit('kite.session.exchange', { userId: user.id, entityType: 'broker_account', entityId: account.id, metadata: { brokerUserId: session.userId, estimatedExpiresAt: estimatedExpiresAt.toISOString() } });
      return { ok: true, brokerAccount: account, estimatedExpiresAt: estimatedExpiresAt.toISOString() };
    } catch (error) {
      set.status = 400;
      return { error: error instanceof Error ? error.message : 'Could not exchange Kite request token' };
    }
  })
  .post('/sync', async ({ cookie, set }) => {
    const user = await requireUser(cookie, set);
    if (!user) return { error: 'Unauthorized' };
    try {
      const [portfolio, orders] = await Promise.all([syncPortfolio(user.id), syncOrders(user.id)]);
      if (!portfolio.ok || !orders.ok) {
        set.status = 400;
        return { error: 'Kite login is required before sync', portfolio, orders };
      }
      await audit('broker.sync.manual', { userId: user.id, metadata: { portfolio, orders } });
      return { ok: true, portfolio, orders };
    } catch (error) {
      set.status = 400;
      return { error: error instanceof Error ? `Kite sync failed: ${error.message}` : 'Kite sync failed' };
    }
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
  })
  .put('/kill-switch', async ({ body, cookie, set }) => {
    const user = await requireUser(cookie, set);
    if (!user) return { error: 'Unauthorized' };
    const input = bodyRecord(body);
    const enabled = Boolean(input.enabled);
    await db.insert(userSettings).values({ userId: user.id, killSwitchEnabled: enabled }).onConflictDoUpdate({
      target: userSettings.userId,
      set: { killSwitchEnabled: enabled, updatedAt: new Date() },
    });
    await audit(enabled ? 'settings.kill_switch.enable' : 'settings.kill_switch.disable', { userId: user.id });
    return { ok: true, killSwitchEnabled: enabled };
  });
