import { and, eq, gt } from 'drizzle-orm';
import { db } from '../db/client';
import { triggerEvents, triggerRules } from '../db/schema';
import type { Quote } from '../providers/broker/types';
import { audit } from '../utils/audit';
import { evaluateTrigger, type TriggerRuleDsl } from './triggers';

export async function evaluateMarketTriggers(userId: string, quotes: Quote[]) {
  const now = new Date();
  let evaluated = 0;
  let matched = 0;
  for (const quote of quotes) {
    const candidates = await db.select().from(triggerRules).where(and(eq(triggerRules.userId, userId), eq(triggerRules.status, 'active'), gt(triggerRules.expiresAt, now)));
    for (const trigger of candidates) {
      const draft = trigger.orderDraft as Record<string, unknown>;
      if (String(draft.exchange ?? 'NSE').toUpperCase() !== quote.exchange.toUpperCase()) continue;
      if (String(draft.tradingsymbol ?? '').toUpperCase() !== quote.tradingsymbol.toUpperCase()) continue;
      evaluated += 1;
      const context = { ltp: quote.lastPrice, changePercent: quote.changePercent ?? 0, volume: quote.volume ?? 0 };
      const isMatch = evaluateTrigger(trigger.rule as TriggerRuleDsl, context);
      await db.update(triggerRules).set({ lastEvaluatedAt: now, updatedAt: now }).where(eq(triggerRules.id, trigger.id));
      if (!isMatch) continue;
      matched += 1;
      await db.insert(triggerEvents).values({ userId, triggerRuleId: trigger.id, eventType: 'matched', matched: true, marketContext: context, message: 'Matched quote; trigger recorded as internal app automation only. No broker API was called.' });
      await db.update(triggerRules).set({ status: 'triggered', updatedAt: now }).where(eq(triggerRules.id, trigger.id));
      await audit('trigger.market.match', { userId, entityType: 'trigger_rule', entityId: trigger.id, metadata: { internalOnly: true, brokerExecution: false } });
    }
  }
  return { evaluated, matched };
}
