import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { approvalRequests, triggerEvents, triggerRules } from '../db/schema';
import { audit } from '../utils/audit';

export type TriggerRuleDsl = {
  version: 1;
  all?: TriggerCondition[];
  any?: TriggerCondition[];
  expiresAt?: string;
};

export type TriggerCondition = { field: 'ltp' | 'changePercent' | 'volume'; op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq'; value: number };

const allowedRoot = new Set(['version', 'all', 'any', 'expiresAt']);
const allowedCondition = new Set(['field', 'op', 'value']);
const allowedFields = new Set(['ltp', 'changePercent', 'volume']);
const allowedOps = new Set(['gt', 'gte', 'lt', 'lte', 'eq']);

export function validateTriggerRule(input: unknown): { rule: TriggerRuleDsl; expiresAt: Date } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('rule must be an object');
  const data = input as Record<string, unknown>;
  rejectUnknown(data, allowedRoot, 'rule');
  if (data.version !== 1) throw new Error('rule.version must be 1');
  const all = data.all === undefined ? undefined : validateConditions(data.all, 'all');
  const any = data.any === undefined ? undefined : validateConditions(data.any, 'any');
  if (!all?.length && !any?.length) throw new Error('rule must include all or any conditions');
  const expiresAt = parseExpiry(data.expiresAt);
  return { rule: { version: 1, all, any, expiresAt: expiresAt.toISOString() }, expiresAt };
}

export function evaluateTrigger(rule: TriggerRuleDsl, context: Record<string, unknown>): boolean {
  const condition = (item: TriggerCondition) => compare(Number(context[item.field] ?? Number.NaN), item.op, item.value);
  const allOk = rule.all?.length ? rule.all.every(condition) : true;
  const anyOk = rule.any?.length ? rule.any.some(condition) : true;
  return allOk && anyOk;
}

export async function listTriggers(userId: string) {
  return db.select().from(triggerRules).where(eq(triggerRules.userId, userId)).orderBy(desc(triggerRules.createdAt));
}

export async function createTrigger(userId: string, input: { name?: unknown; rule: unknown; orderDraft?: unknown; actionPayload?: unknown; status?: unknown }) {
  const { rule, expiresAt } = validateTriggerRule(input.rule);
  const actionPayload = validateInternalActionPayload(input.actionPayload ?? input.orderDraft ?? {});
  const status = input.status === 'draft' ? 'draft' : 'active';
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : 'Internal app trigger';
  const [trigger] = await db.insert(triggerRules).values({ userId, name, rule: rule as unknown as Record<string, unknown>, orderDraft: actionPayload, expiresAt, status }).returning();
  await db.insert(triggerEvents).values({ userId, triggerRuleId: trigger.id, eventType: 'created', matched: false, message: 'Created as internal app trigger; no broker order can be placed by this trigger.', marketContext: {} });
  await audit('trigger.create', { userId, entityType: 'trigger_rule', entityId: trigger.id, metadata: { internalOnly: true } });
  return { trigger, risk: null, approval: null };
}

export async function updateTrigger(userId: string, id: string, input: { name?: unknown; rule?: unknown; orderDraft?: unknown; actionPayload?: unknown; status?: unknown }) {
  const [existing] = await db.select().from(triggerRules).where(and(eq(triggerRules.userId, userId), eq(triggerRules.id, id))).limit(1);
  if (!existing) return null;
  const values: Partial<typeof triggerRules.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) values.name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : existing.name;
  if (input.status !== undefined) values.status = input.status === 'draft' ? 'draft' : input.status === 'active' ? 'active' : existing.status;
  if (input.rule !== undefined) {
    const { rule, expiresAt } = validateTriggerRule(input.rule);
    values.rule = rule as unknown as Record<string, unknown>;
    values.expiresAt = expiresAt;
  }
  if (input.orderDraft !== undefined || input.actionPayload !== undefined) values.orderDraft = validateInternalActionPayload(input.actionPayload ?? input.orderDraft ?? {}) as unknown as Record<string, unknown>;
  const [updated] = await db.update(triggerRules).set(values).where(eq(triggerRules.id, id)).returning();
  await audit('trigger.update', { userId, entityType: 'trigger_rule', entityId: id });
  return updated;
}

export async function cancelTrigger(userId: string, id: string) {
  const [updated] = await db.update(triggerRules).set({ status: 'cancelled', updatedAt: new Date() }).where(and(eq(triggerRules.userId, userId), eq(triggerRules.id, id))).returning();
  if (!updated) return null;
  await db.insert(triggerEvents).values({ userId, triggerRuleId: id, eventType: 'cancelled', matched: false, message: 'Cancelled by user' });
  await audit('trigger.cancel', { userId, entityType: 'trigger_rule', entityId: id });
  return updated;
}

export async function pendingApprovals(userId: string) {
  return db.select().from(approvalRequests).where(and(eq(approvalRequests.userId, userId), eq(approvalRequests.status, 'pending'))).orderBy(desc(approvalRequests.createdAt));
}

export async function decideApproval(userId: string, id: string, decision: 'approved' | 'rejected', note?: string) {
  const [approval] = await db.update(approvalRequests).set({ status: decision, decisionNote: note, decidedAt: new Date(), updatedAt: new Date() }).where(and(eq(approvalRequests.userId, userId), eq(approvalRequests.id, id), eq(approvalRequests.status, 'pending'))).returning();
  if (!approval) return null;
  await audit(`approval.${decision}`, { userId, entityType: 'approval_request', entityId: id, metadata: { note, brokerExecution: false } });
  return { approval, execution: null };
}

function validateInternalActionPayload(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('actionPayload must be an object');
  const payload = value as Record<string, unknown>;
  const forbidden = ['place_order', 'placeOrder', 'regular_order', 'regularOrder', 'market_order', 'marketOrder', 'limit_order', 'limitOrder', 'broker_execution', 'brokerExecution'];
  const text = JSON.stringify(payload).toLowerCase();
  if (forbidden.some((term) => text.includes(term.toLowerCase()))) {
    throw new Error('Triggers are internal app automations only and cannot request broker order execution');
  }
  return payload;
}

function validateConditions(value: unknown, label: string): TriggerCondition[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) throw new Error(`rule.${label} must be a non-empty array with at most 8 conditions`);
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`rule.${label}[${index}] must be an object`);
    const data = item as Record<string, unknown>;
    rejectUnknown(data, allowedCondition, `rule.${label}[${index}]`);
    if (!allowedFields.has(String(data.field))) throw new Error(`rule.${label}[${index}].field is not allowed`);
    if (!allowedOps.has(String(data.op))) throw new Error(`rule.${label}[${index}].op is not allowed`);
    const number = Number(data.value);
    if (!Number.isFinite(number)) throw new Error(`rule.${label}[${index}].value must be a number`);
    return { field: data.field as TriggerCondition['field'], op: data.op as TriggerCondition['op'], value: number };
  });
}

function parseExpiry(value: unknown): Date {
  const expiry = typeof value === 'string' && value.trim() ? new Date(value) : new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (Number.isNaN(expiry.getTime())) throw new Error('rule.expiresAt must be an ISO date');
  if (expiry.getTime() <= Date.now()) throw new Error('rule.expiresAt must be in the future');
  return expiry;
}

function rejectUnknown(data: Record<string, unknown>, allowed: Set<string>, label: string) {
  const unknown = Object.keys(data).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`${label} contains unsupported field(s): ${unknown.join(', ')}`);
}

function compare(left: number, op: TriggerCondition['op'], right: number): boolean {
  if (!Number.isFinite(left)) return false;
  if (op === 'gt') return left > right;
  if (op === 'gte') return left >= right;
  if (op === 'lt') return left < right;
  if (op === 'lte') return left <= right;
  return left === right;
}
