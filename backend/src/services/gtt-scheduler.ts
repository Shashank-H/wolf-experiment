import { eq } from 'drizzle-orm';
import { env } from '../config/env';
import { db } from '../db/client';
import { userSettings } from '../db/schema';
import { audit } from '../utils/audit';
import { revalidateGtts } from './execution';

let timer: ReturnType<typeof setInterval> | null = null;
const lastRunKeys = new Map<string, string>();

export function startGttRevalidationScheduler() {
  if (!env.TRADING_SCHEDULER_WORKER_ENABLED || timer) return null;
  timer = setInterval(() => {
    void tickGttRevalidationScheduler().catch((error) => {
      console.error('GTT revalidation scheduler failed', error);
    });
  }, 60_000);
  void tickGttRevalidationScheduler().catch(() => null);
  console.log('GTT revalidation worker enabled; user intervals are loaded from settings');
  return timer;
}

export async function tickGttRevalidationScheduler(now = new Date()) {
  const settingsRows = await db.select().from(userSettings).where(eq(userSettings.gttRevalidationSchedulerEnabled, true));
  let checked = 0;
  let flagged = 0;
  let autoManaged = 0;
  let users = 0;
  for (const settings of settingsRows) {
    const intervalMs = Math.max(1, settings.gttRevalidationIntervalMinutes) * 60_000;
    const runKey = String(Math.floor(now.getTime() / intervalMs));
    if (lastRunKeys.get(settings.userId) === runKey) continue;
    lastRunKeys.set(settings.userId, runKey);
    const result = await revalidateGtts(settings.userId);
    checked += result.checked;
    flagged += result.flagged;
    autoManaged += result.autoManaged;
    users += 1;
    await audit('gtt.scheduler.revalidate', { userId: settings.userId, metadata: { checked: result.checked, flagged: result.flagged, autoManaged: result.autoManaged } });
  }
  return { skipped: users === 0, users, checked, flagged, autoManaged };
}
