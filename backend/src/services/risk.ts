import { and, count, eq, gte, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { approvalRequests, orders, positions, riskDecisions, tradingPreferences, triggerRules, userSettings } from '../db/schema';

export type OrderDraft = {
  exchange: string;
  tradingsymbol: string;
  transactionType: 'BUY' | 'SELL';
  product: string;
  orderType: string;
  quantity: number;
  price?: number;
  strategy?: string;
  rationale?: string;
};

export type RiskCheck = { check: string; ok: boolean; message: string };
export type RiskResult = { decision: 'ALLOW' | 'BLOCK' | 'NEEDS_APPROVAL' | 'NEEDS_RESEARCH_REVALIDATION'; severity: 'low' | 'medium' | 'high'; reasons: string[]; checks: RiskCheck[] };

const activeOrderStatuses = ['created', 'risk_validated', 'pending_approval', 'approved', 'submitted', 'open'];

export function parseOrderDraft(input: unknown): OrderDraft {
  const data = record(input);
  const quantity = positiveInt(data.quantity, 'quantity');
  const price = optionalPositiveNumber(data.price);
  const draft: OrderDraft = {
    exchange: stringField(data.exchange, 'exchange', 'NSE').toUpperCase(),
    tradingsymbol: stringField(data.tradingsymbol, 'tradingsymbol').toUpperCase(),
    transactionType: stringField(data.transactionType, 'transactionType', 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
    product: stringField(data.product, 'product', 'CNC').toUpperCase(),
    orderType: stringField(data.orderType, 'orderType', price ? 'LIMIT' : 'MARKET').toUpperCase(),
    quantity,
    strategy: typeof data.strategy === 'string' ? data.strategy.trim() : undefined,
    rationale: typeof data.rationale === 'string' ? data.rationale.trim() : undefined,
  };
  if (price !== undefined) draft.price = price;
  return draft;
}

export async function evaluateRisk(userId: string, orderDraftInput: unknown, triggerRuleId?: string): Promise<{ result: RiskResult; row: typeof riskDecisions.$inferSelect }> {
  const orderDraft = parseOrderDraft(orderDraftInput);
  const [settingsRow] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  const [prefs] = await db.select().from(tradingPreferences).where(eq(tradingPreferences.userId, userId)).limit(1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [ordersToday, openPositions, pendingApprovals, duplicateOrders] = await Promise.all([
    db.select({ value: count() }).from(orders).where(and(eq(orders.userId, userId), gte(orders.createdAt, today))),
    db.select({ value: count() }).from(positions).where(eq(positions.userId, userId)),
    db.select({ value: count() }).from(approvalRequests).where(and(eq(approvalRequests.userId, userId), eq(approvalRequests.status, 'pending'))),
    db.select({ value: count() }).from(orders).where(and(eq(orders.userId, userId), eq(orders.exchange, orderDraft.exchange), eq(orders.tradingsymbol, orderDraft.tradingsymbol), inArray(orders.status, activeOrderStatuses))),
  ]);

  const capital = (orderDraft.price ?? 0) * orderDraft.quantity;
  const checks: RiskCheck[] = [];
  checks.push({ check: 'kill_switch', ok: !settingsRow?.killSwitchEnabled, message: settingsRow?.killSwitchEnabled ? 'Kill switch is enabled.' : 'Kill switch is off.' });
  checks.push({ check: 'symbol_blacklist', ok: !(prefs?.symbolBlacklist ?? []).map((x) => x.toUpperCase()).includes(orderDraft.tradingsymbol), message: 'Symbol blacklist check.' });
  checks.push({ check: 'strategy_blacklist', ok: !orderDraft.strategy || !(prefs?.strategyBlacklist ?? []).map((x) => x.toLowerCase()).includes(orderDraft.strategy.toLowerCase()), message: 'Strategy blacklist check.' });
  if ((prefs?.maxTradesPerDay ?? 0) > 0) checks.push({ check: 'max_trades_per_day', ok: Number(ordersToday[0]?.value ?? 0) < Number(prefs?.maxTradesPerDay ?? 0), message: `${ordersToday[0]?.value ?? 0}/${prefs?.maxTradesPerDay} trades used today.` });
  if ((prefs?.maxOpenPositions ?? 0) > 0) checks.push({ check: 'max_open_positions', ok: Number(openPositions[0]?.value ?? 0) < Number(prefs?.maxOpenPositions ?? 0), message: `${openPositions[0]?.value ?? 0}/${prefs?.maxOpenPositions} open positions.` });
  if ((prefs?.maxCapitalPerTrade ?? 0) > 0 && capital > 0) checks.push({ check: 'max_capital_per_trade', ok: capital <= Number(prefs?.maxCapitalPerTrade ?? 0), message: `Estimated capital ${capital} vs limit ${prefs?.maxCapitalPerTrade}.` });
  checks.push({ check: 'max_pending_approvals', ok: Number(pendingApprovals[0]?.value ?? 0) < 10, message: `${pendingApprovals[0]?.value ?? 0}/10 pending approvals.` });
  checks.push({ check: 'duplicate_prevention', ok: Number(duplicateOrders[0]?.value ?? 0) === 0, message: 'No active duplicate order for symbol.' });
  checks.push({ check: 'liquidity_spread_placeholder', ok: true, message: 'Liquidity/spread provider check not wired yet; manual approval still required.' });
  checks.push({ check: 'daily_loss_placeholder', ok: true, message: 'Daily realized PnL feed not wired yet.' });

  const failed = checks.filter((check) => !check.ok);
  const highRisk = capital === 0 || failed.length > 0 || orderDraft.orderType !== 'MARKET';
  const reasons = failed.map((check) => check.message);
  const decision: RiskResult['decision'] = failed.length > 0
    ? 'BLOCK'
    : settingsRow?.triggerResearchPolicy === 'only_high_risk' && highRisk
      ? 'NEEDS_RESEARCH_REVALIDATION'
      : settingsRow?.yoloModeEnabled
        ? 'ALLOW'
        : 'NEEDS_APPROVAL';
  const result: RiskResult = { decision, severity: failed.length ? 'high' : highRisk ? 'medium' : 'low', reasons: reasons.length ? reasons : ['Risk checks passed.'], checks };
  const [row] = await db.insert(riskDecisions).values({ userId, triggerRuleId, decision, severity: result.severity, reasons: result.reasons, checks, orderDraft }).returning();
  return { result, row };
}

export async function createApprovalFromRisk(userId: string, riskDecisionId: string, payload: Record<string, unknown>, triggerRuleId?: string) {
  const [approval] = await db.insert(approvalRequests).values({ userId, triggerRuleId, riskDecisionId, payload, rationale: typeof payload.rationale === 'string' ? payload.rationale : 'Risk validated action needs manual approval.' }).returning();
  return approval;
}

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('orderDraft must be an object');
  return input as Record<string, unknown>;
}

function stringField(value: unknown, key: string, fallback?: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (fallback !== undefined) return fallback;
  throw new Error(`${key} is required`);
}

function positiveInt(value: unknown, name: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer`);
  return number;
}

function optionalPositiveNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error('price must be a positive number when supplied');
  return number;
}
