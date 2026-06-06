# Phase 5B — Live GTT and Order Execution Summary

## Implemented

- Added `gtt_orders` persistence for app-placed Kite GTTs.
- Added `orders.idempotency_key` for safe duplicate prevention on approval-driven order execution.
- Added migration `backend/drizzle/0006_elite_lifeguard.sql`.
- Added live execution service:
  - blocks broker placement when global dry-run mode is enabled
  - blocks broker placement when kill switch is enabled
  - uses deterministic idempotency keys for GTT candidate approvals and approval-request order placement
  - records broker responses in `gtt_orders.raw` / `orders.raw`
  - records order submission lifecycle in `order_events`
- Added GTT APIs:
  - `GET /gtt`
  - `POST /gtt/:id/approve`
  - `POST /gtt/:id/reject`
  - `POST /gtt/:id/cancel`
- Manual approval flow now submits `place_order` approval requests through Kite when allowed.
- Market polling now evaluates active trigger rules against fresh quotes:
  - matched triggers persist `trigger_events`
  - deterministic risk checks run before action
  - manual mode creates approval requests
  - YOLO mode creates an approved request and submits the order through the execution engine
- Added frontend GTT Orders screen:
  - GTT candidates
  - active app-placed GTTs
  - broker GTT status
  - approve/reject/cancel actions

## Safety Notes

- Live placement is globally blocked by dry-run mode and kill switch.
- Broker retries are intentionally conservative. If a broker submission reaches an ambiguous failure state after local order creation, the failed order is retained instead of blindly retrying with the same intent.
- Kite credentials are required for approve/cancel/execute operations; read-only GTT status falls back to empty broker status when Kite is not connected.

## Still Pending

- Dedicated GTT revalidation job for stale thesis, negative news, price drift, and risk-budget changes.
- Richer broker GTT sync/upsert into local `gtt_orders` from Kite status.
- Full dashboard action panel with YOLO status, kill switch, pending approvals, and today PnL.
- Full Phase 6 observability/RCA/notifications screens.
