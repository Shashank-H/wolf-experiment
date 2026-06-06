import { and, eq } from 'drizzle-orm';
import { env } from '../config/env';
import { db } from '../db/client';
import { userSettings, users } from '../db/schema';
import { audit } from '../utils/audit';
import { completeDryRunDay, runDryRunMorning } from './dry-run';
import { indianTradeDate } from './research';

let timer: ReturnType<typeof setInterval> | null = null;
const completedKeys = new Set<string>();

export function startDryRunScheduler() {
  if (!env.DRY_RUN_SCHEDULER_ENABLED || timer) return null;
  timer = setInterval(() => {
    void tickDryRunScheduler().catch((error) => {
      console.error('Dry-run scheduler failed', error);
    });
  }, 60_000);
  void tickDryRunScheduler().catch(() => null);
  console.log(`Dry-run scheduler enabled: morning ${env.DRY_RUN_MORNING_TIME_IST} IST, EOD ${env.DRY_RUN_EOD_TIME_IST} IST`);
  return timer;
}

async function tickDryRunScheduler(now = new Date()) {
  const time = istTime(now);
  const date = indianTradeDate(now);
  if (time === env.DRY_RUN_MORNING_TIME_IST) await runForEnabledUsers('morning', date, (userId) => runDryRunMorning(userId));
  if (time === env.DRY_RUN_EOD_TIME_IST) await runForEnabledUsers('eod', date, (userId) => completeDryRunDay(userId, date));
}

async function runForEnabledUsers(kind: 'morning' | 'eod', tradeDate: string, fn: (userId: string) => Promise<unknown>) {
  const key = `${kind}:${tradeDate}`;
  if (completedKeys.has(key)) return;
  completedKeys.add(key);
  const rows = await db.select({ id: users.id }).from(users).innerJoin(userSettings, and(eq(userSettings.userId, users.id), eq(userSettings.dryRunModeEnabled, true)));
  for (const row of rows) {
    try {
      await fn(row.id);
      await audit(`dry_run.scheduler.${kind}`, { userId: row.id, metadata: { tradeDate } });
    } catch (error) {
      await audit(`dry_run.scheduler.${kind}.failed`, { userId: row.id, metadata: { tradeDate, error: error instanceof Error ? error.message : String(error) } });
    }
  }
}

function istTime(date: Date): string {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  return `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
}
