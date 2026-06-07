import { and, eq } from 'drizzle-orm';
import { env } from '../config/env';
import { db } from '../db/client';
import { userSettings, users } from '../db/schema';
import { audit } from '../utils/audit';
import { completeDryRunDay, runDryRunMorning } from './dry-run';
import { revalidateGtts } from './execution';
import { indianTradeDate } from './research';

let timer: ReturnType<typeof setInterval> | null = null;
const completedKeys = new Set<string>();
const loopRunKeys = new Map<string, string>();

export function startDryRunScheduler() {
  if (!env.TRADING_SCHEDULER_WORKER_ENABLED || timer) return null;
  timer = setInterval(() => {
    void tickDryRunScheduler().catch((error) => {
      console.error('Trading scheduler failed', error);
    });
  }, 60_000);
  void tickDryRunScheduler().catch(() => null);
  console.log('Trading scheduler worker enabled; user schedules are loaded from settings');
  return timer;
}

async function tickDryRunScheduler(now = new Date()) {
  const time = istTime(now);
  const date = indianTradeDate(now);
  const rows = await db.select({ id: users.id, settings: userSettings }).from(users).innerJoin(userSettings, and(eq(userSettings.userId, users.id), eq(userSettings.tradingSchedulerEnabled, true)));
  for (const row of rows) {
    await runIntradayLoopIfDue(row.id, row.settings, now);
    if (time === row.settings.morningResearchTimeIst) await runForUser('morning', date, row.id, () => runDryRunMorning(row.id));
    if (time === row.settings.eodRcaTimeIst) await runForUser('eod', date, row.id, () => completeDryRunDay(row.id, date));
  }
}

async function runIntradayLoopIfDue(userId: string, settings: typeof userSettings.$inferSelect, now: Date) {
  const intervalMs = Math.max(1, settings.tradingLoopIntervalMinutes) * 60_000;
  const key = String(Math.floor(now.getTime() / intervalMs));
  if (loopRunKeys.get(userId) === key) return;
  loopRunKeys.set(userId, key);
  try {
    const gtt = await revalidateGtts(userId);
    await audit('trading.scheduler.intraday_loop', { userId, metadata: { intervalMinutes: settings.tradingLoopIntervalMinutes, gtt } });
  } catch (error) {
    await audit('trading.scheduler.intraday_loop.failed', { userId, metadata: { error: error instanceof Error ? error.message : String(error) } });
  }
}

async function runForUser(kind: 'morning' | 'eod', tradeDate: string, userId: string, fn: () => Promise<unknown>) {
  const key = `${kind}:${tradeDate}:${userId}`;
  if (completedKeys.has(key)) return;
  completedKeys.add(key);
  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  if (!settings?.dryRunModeEnabled) {
    await audit(`trading.scheduler.${kind}.live_not_implemented`, { userId, metadata: { tradeDate } });
    return;
  }
  {
    try {
      await fn();
      await audit(`trading.scheduler.${kind}`, { userId, metadata: { tradeDate, mode: 'dry_run' } });
    } catch (error) {
      await audit(`trading.scheduler.${kind}.failed`, { userId, metadata: { tradeDate, error: error instanceof Error ? error.message : String(error) } });
    }
  }
}

function istTime(date: Date): string {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  return `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
}
