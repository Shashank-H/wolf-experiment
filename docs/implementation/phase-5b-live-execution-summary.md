# Phase 5B — Live GTT-Only Execution Summary

## Implemented

- Added `gtt_orders` persistence for app-placed Kite GTTs.
- Added `orders.idempotency_key` for historical/simulated order tracking; live regular broker order execution is disabled.
- Added migration `backend/drizzle/0006_elite_lifeguard.sql` and later `0010_trading_safety_invariant.sql`.
- Added live GTT execution service:
  - blocks broker placement when global dry-run mode is enabled
  - blocks broker placement when kill switch is enabled
  - uses deterministic idempotency keys for GTT candidate approvals
  - requires two-leg Kite GTTs with both target and stoploss
  - records broker responses in `gtt_orders.raw`
- Added GTT APIs:
  - `GET /gtt`
  - `POST /gtt/:id/approve`
  - `POST /gtt/:id/reject`
  - `POST /gtt/:id/cancel`
- Manual approval flow records internal decisions only; it never submits regular broker orders.
- Market polling now evaluates active trigger rules against fresh quotes:
  - matched triggers persist `trigger_events`
  - triggers are internal app automations only
  - triggers never call broker execution APIs
- Added frontend GTT Orders screen:
  - GTT candidates
  - active app-placed GTTs
  - broker GTT status
  - approve/reject/cancel actions

## Safety Notes

- Live placement is globally blocked by dry-run mode and kill switch.
- Broker retries are intentionally conservative. Wolf never places or retries regular market/limit orders.
- Kite credentials are required for GTT approve/cancel operations; read-only GTT status falls back to empty broker status when Kite is not connected.

## Still Pending

- Dedicated GTT revalidation job for stale thesis, negative news, price drift, and risk-budget changes.
- Richer broker GTT sync/upsert into local `gtt_orders` from Kite status.
- Full dashboard action panel with YOLO status, kill switch, pending approvals, and today PnL.
- Full Phase 6 observability/RCA/notifications screens.
