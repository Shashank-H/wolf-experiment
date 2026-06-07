import { env } from '../config/env';
import { audit } from '../utils/audit';
import { revalidateStaleGttsForAllUsers } from './execution';

let timer: ReturnType<typeof setInterval> | null = null;
let lastRunKey: string | null = null;

export function startGttRevalidationScheduler() {
  if (!env.GTT_REVALIDATION_SCHEDULER_ENABLED || timer) return null;
  timer = setInterval(() => {
    void tickGttRevalidationScheduler().catch((error) => {
      console.error('GTT revalidation scheduler failed', error);
    });
  }, 60_000);
  void tickGttRevalidationScheduler().catch(() => null);
  console.log(`GTT revalidation scheduler enabled: every ${env.GTT_REVALIDATION_INTERVAL_MINUTES} minutes`);
  return timer;
}

export async function tickGttRevalidationScheduler(now = new Date()) {
  const intervalMs = Math.max(1, env.GTT_REVALIDATION_INTERVAL_MINUTES) * 60_000;
  const runKey = String(Math.floor(now.getTime() / intervalMs));
  if (runKey === lastRunKey) return { skipped: true, reason: 'already_ran_this_interval' };
  lastRunKey = runKey;

  const results = await revalidateStaleGttsForAllUsers();
  const checked = results.reduce((sum, result) => sum + result.checked, 0);
  const flagged = results.reduce((sum, result) => sum + result.flagged, 0);
  await audit('gtt.scheduler.revalidate', { metadata: { checked, flagged, users: results.length } });
  return { skipped: false, users: results.length, checked, flagged };
}
