# Implementation Handoff Context — AI Trading Copilot MVP

Source docs reviewed:
- `docs/MVP.md`
- `docs/architecture.md`
- `docs/implementation-plan.md`

This handoff distills the implementation contract for the MVP and a safe incremental build slice.

## 1. MVP Outcome

Build a single-user-first, multi-user-ready AI trading copilot for Zerodha Kite that:

- runs pre-market research;
- generates market thesis, watchlists, trigger rules, trade candidates, and GTT suggestions;
- polls market data on a configurable schedule;
- evaluates strict deterministic trigger JSON DSL;
- requires risk validation before every order/GTT;
- supports manual approvals and optional YOLO auto-execution;
- persists every AI, risk, approval, execution, and RCA decision;
- generates end-of-day RCA;
- runs as Bun/Elysia + React/Vite with PostgreSQL, Redis, BullMQ, and Docker Compose on one EC2 instance.

Key source evidence:
- Product goal and flow: `docs/MVP.md:3-15`, `docs/MVP.md:87-115`.
- Core architecture: `docs/architecture.md:41-66`.
- Core design principles: `docs/architecture.md:70-79`.
- Confirmed decisions: `docs/implementation-plan.md:3-10`.

## 2. Hard MVP Scope

### Included

Trading:
- Indian equities only.
- Intraday and swing trading.
- GTT workflows.
- Manual approval mode.
- Optional YOLO mode.

AI:
- Morning market research.
- AI-generated watchlists, trigger rules, GTT suggestions.
- Market regime analysis.
- EOD RCA analysis.

Risk:
- Max daily loss.
- Max capital/trade size.
- Max trades per day.
- Max sector exposure.
- Max open positions.
- Duplicate prevention.
- Cooldowns.
- Liquidity/spread checks.
- Kill switch.

Infrastructure/observability:
- Bun + Elysia backend, React + Vite frontend.
- Drizzle ORM + PostgreSQL.
- Redis + BullMQ.
- Docker Compose on EC2.
- Langfuse, AI trace storage, audit logs, prompt/model tracking.

Source: `docs/MVP.md:19-67`, `docs/architecture.md:1396-1420`.

### Excluded / Non-goals

Do not implement in MVP:
- paper trading;
- replay/backtesting;
- multi-agent systems/debate;
- WebSockets/SSE;
- multi-user billing;
- mobile app;
- Kubernetes;
- horizontal scaling;
- external market data providers;
- F&O;
- global/US markets;
- broker/strategy marketplace.

Source: `docs/MVP.md:70-83`, `docs/architecture.md:1422-1438`.

## 3. Architecture and Structure Constraints

- MVP starts as single user, but all relevant/core tables must include `user_id` for future multi-user support (`docs/architecture.md:13-24`, `docs/implementation-plan.md:3-10`).
- REST only for MVP; frontend polls APIs. No WebSockets/SSE (`docs/architecture.md:145-151`).
- Providers must be adapter-based from day one (`docs/MVP.md:150-193`, `docs/architecture.md:70-79`).
- Same app process can run API + workers initially, but code should support worker split later (`docs/MVP.md:395-411`, `docs/architecture.md:324-347`).
- Implementation plan prefers independent `backend/` and `frontend/` projects rather than shared packages for the MVP (`docs/implementation-plan.md:25-74`). This differs from the broader architecture's future monorepo example under `apps/`/`packages/`; use the implementation plan as the immediate coding target.

Initial repo shape from plan:

```txt
backend/
  src/
  drizzle/
  package.json
frontend/
  src/
  package.json
infra/
  docker-compose.yml
.env.example
```

Source: `docs/implementation-plan.md:25-74`.

## 4. Required Modules

Backend modules suggested by architecture:

```txt
auth
users
settings
broker
market-data
research
llm
watchlist
triggers
risk
orders
gtt
portfolio
approvals
jobs
notifications
rca
observability
audit
```

Source: `docs/architecture.md:153-175`.

Frontend screens/responsibilities:

```txt
Dashboard
Morning Research
Watchlist
Trigger Rules
Pending Approvals
GTT Orders
Orders
Positions
Holdings
Risk Settings
Agent Runs
EOD RCA
Settings
```

MVP UI must show research, watchlist, trigger rules, pending GTT approvals, YOLO status, approvals/rejections, positions, order state, risk warnings, RCA reports, and API/preferences settings. Source: `docs/architecture.md:85-128`.

## 5. Provider Interfaces and Integrations

### Broker / Kite

MVP broker is Zerodha Kite. Adapter should support profile, holdings, positions, margins, quotes, order place/modify/cancel, GTT create/modify/cancel, orders, and GTT list.

Source: `docs/architecture.md:181-210`.

### Market Data

MVP market data is Kite only. Future external providers can be added behind `MarketDataProvider`.

Source: `docs/architecture.md:225-240`.

### Research

MVP research providers are Exa and Finnhub behind `ResearchProvider` with search, ticker news, and market news methods.

Source: `docs/architecture.md:245-262`.

### LLM

OpenAI-compatible provider. User can configure small/medium/big models:
- small: classification, JSON cleanup, simple summarization, trigger-time quick validation;
- medium: periodic research refresh, trade thesis validation, watchlist ranking;
- big: morning deep research, complex RCA, strategy review, ambiguous market analysis.

Source: `docs/architecture.md:278-320`.

## 6. Jobs and Schedules

BullMQ queues:

```txt
research.queue
polling.queue
trigger.queue
risk.queue
execution.queue
gtt.queue
notification.queue
rca.queue
maintenance.queue
```

Important jobs:

```txt
morning_research
market_poll
evaluate_triggers
validate_trigger_with_research
create_gtt
revalidate_gtts
sync_orders
sync_positions
send_notification
eod_rca
cleanup_expired_triggers
```

Source: `docs/architecture.md:358-386`.

MVP schedules:
- `morning_research`: before market open.
- `market_poll`: hourly by default, configurable.
- `gtt_revalidation`: configurable, suggested every 30-60 min.
- `sync_orders`: configurable, suggested every 5-15 min during market hours.
- `sync_positions`: configurable, suggested every 5-15 min during market hours.
- `eod_rca`: after market close.

Source: `docs/architecture.md:1294-1314`.

## 7. Core Flows

### Morning Research

Inputs:
- user risk preferences;
- previous RCA learnings;
- holdings and positions;
- available capital;
- watchlist history;
- market/ticker/sector/global news;
- Kite quote data.

Outputs:
- market regime;
- sector bias;
- daily watchlist;
- trade candidates;
- trigger rules;
- GTT suggestions;
- risk warnings;
- capital allocation suggestion;
- no-trade recommendation if applicable.

Flow: fetch broker state -> fetch Exa/Finnhub research -> fetch Kite quotes -> LLM structured daily plan -> risk pre-validation -> persist research session -> create watchlist items, trigger rules, pending GTT candidates -> notify user.

Source: `docs/architecture.md:431-493`, `docs/implementation-plan.md:224-302`.

### Polling

- Default hourly; configurable per user: hourly, 30 min, 15 min, 5 min, 1 min, custom cron.
- Poll only active watchlist symbols, open positions, active GTT-related symbols, and active trigger symbols.
- Flow: load active symbols -> batch fetch Kite quotes -> store latest quotes in Redis -> persist selected snapshots in Postgres -> enqueue trigger evaluation.

Source: `docs/MVP.md:221-242`, `docs/architecture.md:497-555`.

### Trigger Engine

- Deterministic rule evaluation only.
- Strict JSON DSL; no arbitrary code execution.
- Configurable/defaulted expiry and lifecycle tracking.
- Supported operators: `gt`, `gte`, `lt`, `lte`, `eq`, `neq`, `between`, `crosses_above`, `crosses_below`.
- Supported fields: `ltp`, `changePercent`, `volume`, `volumeRatio`, `dayHigh`, `dayLow`, `open`, `previousClose`, `positionPnl`, `marketRegime`, `sectorBias`, `time`.
- States: `draft`, `pending_approval`, `active`, `triggered`, `expired`, `cancelled`, `rejected`, `executed`.

Source: `docs/MVP.md:265-273`, `docs/architecture.md:559-633`, `docs/implementation-plan.md:306-379`.

### Trigger-time Research

Confirmed default in implementation plan: `only_high_risk`. Keep policy configurable. Trigger-time research should answer whether anything materially changed since the morning thesis, not re-plan the whole trade.

Source: `docs/implementation-plan.md:3-10`, `docs/architecture.md:637-671`.

### Risk Engine

Risk engine is mandatory before any order or GTT.

Controls:
- max daily loss;
- max trades per day;
- max capital per trade;
- max open positions;
- max sector exposure;
- cooldown between trades;
- duplicate order prevention;
- symbol blacklist;
- strategy blacklist;
- market regime filter;
- minimum liquidity/spread check;
- max active GTTs;
- max pending approvals;
- kill switch.

Risk decision type:

```ts
type RiskDecision =
  | "APPROVED"
  | "REJECTED"
  | "NEEDS_USER_APPROVAL"
  | "NEEDS_RESEARCH_REVALIDATION";
```

Every risk decision must store input, decision, reasons, risk rule versions, timestamp, `user_id`, and `trade_candidate_id`.

Source: `docs/MVP.md:277-292`, `docs/architecture.md:724-768`, `docs/implementation-plan.md:328-346`.

### Approval, YOLO, and Execution

Manual mode:
- User approval required before order placement, GTT placement, and trade execution.

YOLO mode:
- Can skip user approval after morning analysis but must not skip risk checks.
- Must still enforce daily loss, max capital limits, duplicate prevention, cooldowns, kill switch, and audit logs.
- Enabling YOLO mode requires explicit confirmation.

Execution engine:
- places/modifies/cancels orders and GTTs;
- syncs order status and positions;
- handles rejection;
- stores broker responses;
- uses idempotency keys and duplicate prevention;
- protects against broker rate limits;
- retries only when safe;
- never blindly retries market orders.

Idempotency key example: `user_id + date + symbol + strategy_id + action + trigger_rule_id`.

Source: `docs/MVP.md:197-218`, `docs/architecture.md:390-427`, `docs/architecture.md:772-812`, `docs/architecture.md:1318-1350`, `docs/implementation-plan.md:382-447`.

### GTT Flow

Manual: AI suggests GTT -> risk validation -> user approval -> place via Kite.

YOLO: AI suggests GTT -> risk validation -> auto-place.

Revalidation checks: stale thesis, changed market regime, negative news, price moved too far, expired setup, daily risk breached. Actions: keep, cancel, flag for review.

Source: `docs/MVP.md:296-318`, `docs/architecture.md:675-720`, `docs/implementation-plan.md:382-447`.

### EOD RCA

Inputs: morning research session, watchlist items, trigger rules, GTTs, orders, positions, market snapshots, news snapshots, AI decisions, risk decisions, PnL, manual overrides.

Outputs: daily summary, trade-level RCA, strategy-level RCA, agent reasoning review, risk review, recommended improvements, prompt improvement suggestions.

Categories include thesis correctness, entry timing, trigger timing, stop/target quality, market regime mismatch, news changed thesis, risk engine prevented loss, and user override impact.

Source: `docs/MVP.md:322-334`, `docs/architecture.md:816-865`, `docs/implementation-plan.md:450-516`.

## 8. API Endpoint Contract

### Auth

```txt
POST /auth/register
POST /auth/login
POST /auth/logout
GET  /auth/me
```

### Settings

```txt
GET  /settings
PUT  /settings/trading
PUT  /settings/providers
PUT  /settings/yolo-mode
```

### Research

```txt
POST /research/run-morning
GET  /research/today
GET  /research/:id
```

### Watchlist

```txt
GET    /watchlist/today
POST   /watchlist/manual
DELETE /watchlist/:id
```

### Triggers

```txt
GET  /triggers
POST /triggers
PUT  /triggers/:id
POST /triggers/:id/cancel
```

### Approvals

```txt
GET  /approvals/pending
POST /approvals/:id/approve
POST /approvals/:id/reject
```

### Orders

```txt
GET  /orders
GET  /orders/:id
POST /orders/:id/cancel
```

### GTT

```txt
GET  /gtt
POST /gtt/:id/approve
POST /gtt/:id/reject
POST /gtt/:id/cancel
```

### Portfolio

```txt
GET /portfolio/holdings
GET /portfolio/positions
GET /portfolio/pnl
```

### RCA

```txt
POST /rca/run-eod
GET  /rca/today
GET  /rca/:id
```

### Notifications

```txt
GET  /notifications
POST /notifications/:id/read
```

Source: `docs/implementation-plan.md:608-699`, also `docs/architecture.md:1206-1290`.

## 9. Data Model / Schema Plan

All relevant tables should include `id`, `user_id`, `created_at`, and `updated_at` where relevant. Source: `docs/architecture.md:869-884`.

### Foundation

```txt
users
sessions
api_keys
user_settings
trading_preferences
audit_logs
```

### Provider Config

```txt
broker_accounts
market_data_provider_configs
research_provider_configs
llm_provider_configs
```

### AI / Research

```txt
daily_research_sessions
research_sources
market_regime_snapshots
sector_bias_snapshots
agent_runs
agent_messages
prompt_versions
model_usage_logs
```

### Trading

```txt
watchlist_items
trade_candidates
trigger_rules
trigger_events
approval_requests
orders
order_events
gtt_candidates
gtt_orders
positions
holdings_snapshots
market_snapshots
```

### Risk / RCA / Notifications

```txt
risk_decisions
trade_outcomes
rca_reports
rca_findings
strategy_learnings
notifications
```

Source: `docs/implementation-plan.md:553-604`.

## 10. Security, Audit, Observability

### API keys and secrets

- API keys must be encrypted at rest, user-specific, and never exposed to frontend after storage.
- Secrets to encrypt: Kite API key/access token, Exa API key, Finnhub API key, OpenAI-compatible API keys, Telegram bot token.
- MVP encryption: `APP_ENCRYPTION_KEY` with AES-256-GCM.
- Store `encrypted_value`, `iv`, `auth_tag`, `key_version`.

Source: `docs/MVP.md:356-368`, `docs/architecture.md:952-985`, `docs/implementation-plan.md:109-123`.

### Auth

Local email/password auth is required and should not be skipped. Use bcrypt or argon2 hashing, httpOnly cookies, session expiry, and CSRF protection if cookie-based.

Source: `docs/architecture.md:996-1012`.

### Audit logs

Mandatory for login, logout/settings changes, API key changes, YOLO enable/disable, order placed, GTT placed, risk override, approval/rejection, and kill switch activation.

Source: `docs/architecture.md:1045-1059`, `docs/implementation-plan.md:123-129`.

### Langfuse / Observability

Use Langfuse for LLM traces, prompt versions, model usage, latency, cost, AI output inspection, and RCA traceability. Store structured logs for job execution, broker calls, risk decisions, order/GTT submissions, and errors.

Source: `docs/MVP.md:372-379`, `docs/architecture.md:1016-1043`, `docs/implementation-plan.md:450-516`.

## 11. Safety-Critical Acceptance Criteria

Before live execution is considered complete:

- Risk engine is mandatory for every order and GTT.
- Kill switch blocks all new automated action.
- YOLO mode cannot bypass risk checks.
- Every execution request has an idempotency key.
- Duplicate prevention is tested.
- API keys are encrypted at rest and never returned decrypted.
- Broker responses are stored.
- Every approval/rejection is audited.
- Every risk decision stores input, decision, reasons, rule version, timestamp, and `user_id`.
- Trigger evaluation has no arbitrary code execution.

Source: `docs/implementation-plan.md:703-716`.

Additional safety invariants from architecture:
- AI reasons but does not execute directly.
- Deterministic services own polling, triggers, risk, execution, and state transitions.
- LLM outputs proposals only; execution accepts validated internal objects.
- Kill switch must be able to pause polling, disable YOLO, cancel pending internal triggers, optionally cancel active GTTs, and block new orders.

Source: `docs/architecture.md:70-79`, `docs/architecture.md:1318-1350`.

## 12. Sensible Incremental MVP Slice

Start with Phase 0 + first half of Phase 1 exactly as the implementation plan recommends. This provides a safe foundation before Kite integration or automation.

### Sprint 1: Foundation Bootstrap

Deliver:
1. Independent `backend/` and `frontend/` project structure.
2. Bun/Elysia backend app with:
   - `GET /health`
   - `GET /ready`
3. React + Vite frontend app.
4. Docker Compose for Postgres and Redis.
5. Drizzle setup.
6. Initial schema/migrations for:
   - `users`
   - `sessions`
   - `api_keys`
   - `user_settings`
   - `trading_preferences`
   - `audit_logs`
7. Encryption utility and env validation:
   - `APP_ENCRYPTION_KEY`
   - AES-256-GCM
   - encrypted value columns (`encrypted_value`, `iv`, `auth_tag`, `key_version`)
8. `.env.example`.
9. Root scripts:
   - `bun run dev`
   - `bun run dev:backend`
   - `bun run dev:frontend`
   - `bun run db:generate`
   - `bun run db:migrate`
   - `bun run db:studio`
   - `bun run typecheck`

Source: `docs/implementation-plan.md:25-149`, `docs/implementation-plan.md:720-733`.

### Sprint 1 acceptance criteria

- Backend and frontend start independently.
- Postgres and Redis boot via Docker Compose.
- Health and readiness endpoints respond.
- Drizzle can generate and run initial migrations.
- User auth/settings tables exist and include future-ready `user_id` where relevant.
- Encryption helper has tests or at least direct validation for encrypt/decrypt round-trip and auth-tag tamper failure.
- API keys cannot be returned decrypted by any settings/provider endpoint.
- Typecheck passes.

### Next slices after Sprint 1

1. Finish Phase 1: auth routes, sessions, settings APIs, encrypted provider credential storage, YOLO toggle with confirmation/audit.
2. Phase 2: Kite adapter, portfolio/order sync, quote polling and Redis market cache.
3. Phase 3: Exa/Finnhub/OpenAI-compatible adapters and morning research persistence.
4. Phase 4: trigger DSL, risk engine, approval flow, kill switch.
5. Phase 5: GTT/order execution, YOLO execution path after risk approval only.
6. Phase 6: EOD RCA, Langfuse, notifications.
7. Phase 7: EC2 Docker Compose hardening.

Source: `docs/implementation-plan.md:153-549`.

## 13. Risks / Open Decisions / Assumptions

- Trigger-time research was marked TBD in architecture, but implementation plan confirms default `only_high_risk`; use that unless product changes it (`docs/architecture.md:1354-1374`, `docs/implementation-plan.md:3-10`).
- Architecture shows a future `apps/`/`packages/` monorepo, but implementation plan explicitly asks for independent `backend/` and `frontend/` for MVP. Prefer the implementation plan for immediate work.
- UI style is minimal utility UI per implementation plan; do not spend MVP time on elaborate visuals (`docs/implementation-plan.md:3-10`).
- Paper trading/replay are non-goals. Do not build `PaperBrokerAdapter` implementation in MVP, though keeping adapter interfaces extensible is acceptable.
- Live trading risk is the main project risk. Do not implement execution before auth, encrypted settings, auditing, risk engine, idempotency, duplicate prevention, and kill switch are in place.
