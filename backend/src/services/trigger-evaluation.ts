import { and, eq, gt } from 'drizzle-orm';
import { db } from '../db/client';
import { approvalRequests, triggerEvents, triggerRules } from '../db/schema';
import type { Quote } from '../providers/broker/types';
import { audit } from '../utils/audit';
import { executeApprovedOrderFromApproval } from './execution';
import { createApprovalFromRisk, evaluateRisk } from './risk';
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
      const { result, row } = await evaluateRisk(userId, trigger.orderDraft, trigger.id);
      let approvalId: string | undefined;
      let orderId: string | undefined;
      if (result.decision === 'ALLOW') {
        const [approval] = await db.insert(approvalRequests).values({ userId, triggerRuleId: trigger.id, riskDecisionId: row.id, status: 'approved', requestedAction: 'place_order', payload: trigger.orderDraft, rationale: 'YOLO mode risk-approved trigger execution.', decidedAt: now, decisionNote: 'Auto-approved by YOLO mode.' }).returning();
        approvalId = approval.id;
        const execution = await executeApprovedOrderFromApproval(userId, approval.id);
        orderId = execution?.order.id;
      } else if (result.decision === 'NEEDS_APPROVAL' || result.decision === 'NEEDS_RESEARCH_REVALIDATION') {
        const approval = await createApprovalFromRisk(userId, row.id, trigger.orderDraft as Record<string, unknown>, trigger.id);
        approvalId = approval.id;
      }
      await db.insert(triggerEvents).values({ userId, triggerRuleId: trigger.id, eventType: 'matched', matched: true, marketContext: context, message: `Matched quote; risk decision ${result.decision}` });
      await db.update(triggerRules).set({ status: 'triggered', updatedAt: now }).where(eq(triggerRules.id, trigger.id));
      await audit('trigger.market.match', { userId, entityType: 'trigger_rule', entityId: trigger.id, metadata: { riskDecision: result.decision, approvalId, orderId } });
    }
  }
  return { evaluated, matched };
}
