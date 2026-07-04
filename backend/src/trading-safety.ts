export const TRADING_SAFETY_INVARIANT = [
  'Wolf never places regular market/limit orders.',
  'The only broker-side trading action allowed is placing, modifying, or cancelling Kite GTT orders that include both stoploss and target.',
  'App triggers are internal workflow automations only. They must never directly call broker execution APIs.',
].join(' ');

export function regularOrderExecutionDisabled(): never {
  throw new Error(`${TRADING_SAFETY_INVARIANT} Regular broker order placement/modification/cancellation is disabled.`);
}
