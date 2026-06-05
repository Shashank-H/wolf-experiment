# AI Trading Copilot — MVP Implementation Plan

## Confirmed Decisions

- Implementation target: MVP from `docs/MVP.md` and `docs/architecture.md`.
- Frontend style: minimal utility UI, optimized for fast implementation and operational clarity.
- Trigger-time research default: `only_high_risk`.
- MVP mode: single user, but all relevant core tables include `user_id`.
- MVP market: Indian equities via Zerodha Kite.
- MVP deployment: Docker Compose on one EC2 instance.

---

## Guiding Principles

1. Ship safety-critical foundations before automation.
2. Treat LLM output as proposals only; deterministic services own validation and execution.
3. Every AI, risk, approval, and execution decision must be persisted.
4. Keep provider integrations adapter-based from day one.
5. Implement single-process API + workers first, with code structure ready for worker split later.
6. Prefer simple REST polling over realtime transports for MVP.

---

## Phase 0 — Repository Bootstrap

### Goals

Create a working repository foundation with independent `backend/` and `frontend/` codebases that can run locally with Docker services.

### Tasks

- Initialize repository with separate backend and frontend projects.
- Keep backend and frontend code independent; avoid shared runtime packages in the MVP unless duplication becomes painful.
- Add structure:

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

- Add TypeScript configs.
- Add formatting/linting baseline.
- Add root scripts:

```txt
bun run dev
bun run dev:backend
bun run dev:frontend
bun run db:generate
bun run db:migrate
bun run db:studio
bun run typecheck
```

- Add `.env.example` with required variables.
- Add Docker Compose services:
  - postgres
  - redis
  - app placeholder or later production target

### Deliverables

- Monorepo runs locally.
- Backend and frontend apps can start independently.
- Postgres and Redis boot via Docker Compose.

---

## Phase 1 — Foundation: API, DB, Auth, Settings

### Goals

Build the secure base needed before broker or AI integration.

### Backend Tasks

- Create Elysia API app.
- Add health endpoints:

```txt
GET /health
GET /ready
```

- Add database package using Drizzle + PostgreSQL.
- Add initial schema:
  - `users`
  - `sessions`
  - `api_keys`
  - `user_settings`
  - `trading_preferences`
  - `audit_logs`

- Add local auth:
  - email/password registration
  - login/logout
  - session cookie
  - password hashing with Argon2 or bcrypt

- Add encryption utility:
  - AES-256-GCM
  - `APP_ENCRYPTION_KEY`
  - columns: `encrypted_value`, `iv`, `auth_tag`, `key_version`

- Add settings APIs:

```txt
GET  /settings
PUT  /settings/trading
PUT  /settings/research
PUT  /settings/providers
PUT  /settings/yolo-mode
```

- Ensure API keys are never returned decrypted.
- Add audit logs for:
  - login
  - logout
  - settings change
  - API key create/update/delete
  - YOLO enable/disable

### Frontend Tasks

Minimal utility screens:

- Login/register screen.
- Trading settings screen:
  - risk limits
  - research generation limits
  - risk tolerance/risk style
  - YOLO mode toggle with confirmation copy
  - kill switch
- App/provider settings screen:
  - Kite credentials
  - Exa key
  - Finnhub key
  - OpenAI-compatible LLM config
- Home page setup CTA:
  - show missing API keys, broker auth, or expired token issues
  - link to app/provider settings when action is required

### Deliverables

- User can register/login.
- User can store encrypted provider credentials.
- User can configure risk/trading preferences.
- User can configure morning research output limits and risk style.
- YOLO mode changes are audited.

---

## Phase 2 — Providers: Kite, Market Data, Portfolio Sync

### Goals

Integrate Zerodha Kite behind adapter interfaces and synchronize broker state.

### Backend Tasks

- Define provider interfaces:
  - `BrokerAdapter`
  - `MarketDataProvider`

- Implement `KiteBrokerAdapter` methods:
  - profile
  - holdings
  - positions
  - margins
  - quotes
  - orders
  - GTT list/create/modify/cancel
  - order place/modify/cancel

- Add schema:
  - `broker_accounts`
  - `holdings_snapshots`
  - `positions`
  - `orders`
  - `order_events`
  - `market_snapshots`

- Add BullMQ queues and processors:
  - `sync_orders`
  - `sync_positions`
  - `market_poll`

- Add Redis quote cache.
- Add portfolio APIs:

```txt
GET /portfolio/holdings
GET /portfolio/positions
GET /portfolio/pnl
```

- Add order APIs:

```txt
GET  /orders
GET  /orders/:id
POST /orders/:id/cancel
```

### Frontend Tasks

- Portfolio screen:
  - holdings table
  - positions table
  - PnL summary
- Orders screen:
  - order list
  - status
  - cancel action where allowed

### Deliverables

- Broker credentials can be used to fetch holdings, positions, margins, orders, and quotes.
- Market polling stores latest quote cache and selected snapshots.
- Portfolio and order state visible in UI.

---

## Phase 3 — AI Research Providers and Morning Research

### Goals

Run morning research and persist structured AI output.

### Backend Tasks

- Define provider interfaces:
  - `ResearchProvider`
  - `LlmProvider`

- Implement adapters:
  - `ExaProvider`
  - `FinnhubProvider`
  - `OpenAiCompatibleProvider`

- Add model tier config:
  - small
  - medium
  - big

- Add schemas:
  - `research_provider_configs`
  - `llm_provider_configs`
  - `daily_research_sessions`
  - `research_sources`
  - `market_regime_snapshots`
  - `sector_bias_snapshots`
  - `agent_runs`
  - `agent_messages`
  - `prompt_versions`
  - `model_usage_logs`
  - `watchlist_items`
  - `trade_candidates`
  - `gtt_candidates`

- Build morning research job:

```txt
fetch broker state
fetch research/news
fetch Kite quote context
call LLM for structured daily plan
validate JSON shape
persist research session
create watchlist items
create trigger drafts
create GTT candidates
create notification
```

- Add APIs:

```txt
POST /research/run-morning
GET  /research/today
GET  /research/:id
GET  /watchlist/today
POST /watchlist/manual
DELETE /watchlist/:id
```

### Frontend Tasks

- Morning Research screen:
  - run button
  - summary-first market thesis
  - watchlist preview
  - trade/GTT/warning counts
  - right-side deep-dive drawer for sector bias, full watchlist, trade candidates, GTT suggestions, sources, and risk warnings

### Deliverables

- User can manually run morning research.
- Structured research output is stored and visible.
- Watchlist and initial trade/GTT candidates are created.

---

## Phase 4 — Trigger DSL, Risk Engine, Approval Workflow

### Goals

Make generated trade ideas actionable but safe.

### Backend Tasks

- Define Trigger JSON DSL types.
- Implement strict trigger validator:
  - allowed fields only
  - allowed operators only
  - no arbitrary code
  - expiry required or defaulted

- Implement deterministic trigger evaluator.
- Add schemas:
  - `trigger_rules`
  - `trigger_events`
  - `approval_requests`
  - `risk_decisions`

- Implement risk engine controls:
  - max daily loss
  - max trades per day
  - max capital per trade
  - max open positions
  - max sector exposure
  - cooldowns
  - duplicate prevention
  - symbol blacklist
  - strategy blacklist
  - market regime filter
  - minimum liquidity/spread check
  - max active GTTs
  - max pending approvals
  - kill switch

- Persist every risk decision.
- Add trigger-time research policy config with default `only_high_risk`.
- Implement `NEEDS_RESEARCH_REVALIDATION` path for high-risk triggers.
- Add APIs:

```txt
GET  /triggers
POST /triggers
PUT  /triggers/:id
POST /triggers/:id/cancel
GET  /approvals/pending
POST /approvals/:id/approve
POST /approvals/:id/reject
```

### Frontend Tasks

- Trigger Rules screen:
  - active/draft/expired rules
  - rule JSON display
  - cancel action
- Pending Approvals screen:
  - candidate details
  - risk result
  - approve/reject actions
- Trading Settings screen:
  - core limits with defaults
  - kill switch
  - YOLO mode
  - research risk style and candidate limits

### Deliverables

- Trigger rules are deterministic and auditable.
- Every candidate is risk checked.
- Manual approval workflow works end-to-end.
- Kill switch blocks new execution activity.

---

## Phase 5 — GTT and Order Execution

### Goals

Place Kite GTTs/orders safely in manual and YOLO modes.

### Backend Tasks

- Add schemas:
  - `gtt_orders`
  - extend `orders` and `order_events` as needed

- Implement execution engine:
  - idempotency keys
  - duplicate prevention
  - safe retries only
  - broker response logging
  - state transitions

- Implement GTT candidate flow:
  - manual approval places GTT
  - YOLO auto-places only after risk approval

- Implement order placement flow:
  - trigger hit
  - risk check
  - approval or YOLO path
  - execute through Kite
  - persist result

- Add GTT revalidation job:
  - stale thesis
  - changed market regime
  - negative news
  - price moved too far
  - expired setup
  - daily risk breached

- Add APIs:

```txt
GET  /gtt
POST /gtt/:id/approve
POST /gtt/:id/reject
POST /gtt/:id/cancel
```

### Frontend Tasks

- GTT Orders screen:
  - candidates
  - active GTTs
  - broker status
  - approve/reject/cancel
- Dashboard action panel:
  - YOLO status
  - kill switch
  - pending approvals
  - today PnL

### Deliverables

- Approved GTTs can be placed through Kite.
- YOLO mode can place GTTs/orders only after risk approval.
- Execution events and broker responses are auditable.

---

## Phase 6 — EOD RCA, Observability, Notifications

### Goals

Close the feedback loop and provide traceability.

### Backend Tasks

- Add Langfuse integration for:
  - LLM traces
  - prompts
  - model usage
  - latency
  - cost

- Add schemas:
  - `trade_outcomes`
  - `rca_reports`
  - `rca_findings`
  - `strategy_learnings`
  - `notifications`

- Implement EOD RCA job:

```txt
load morning thesis
load trades/GTTs/orders
load trigger events
load market snapshots
load risk decisions
load PnL
call LLM for RCA
persist report/findings/learnings
notify user
```

- Add notification APIs:

```txt
GET  /notifications
POST /notifications/:id/read
```

- Add RCA APIs:

```txt
POST /rca/run-eod
GET  /rca/today
GET  /rca/:id
```

### Frontend Tasks

- EOD RCA screen:
  - daily summary
  - trade-level findings
  - risk review
  - improvement suggestions
- Agent Runs screen:
  - prompts/models/cost/latency summary
- Notifications list.

### Deliverables

- EOD RCA can be generated and reviewed.
- Langfuse traces connect AI outputs to stored app records.
- In-app notifications cover MVP events.

---

## Phase 7 — Deployment Hardening

### Goals

Prepare for EC2 deployment with safe operations.

### Tasks

- Add production Dockerfile.
- Finalize Docker Compose:
  - app
  - postgres
  - redis
- Add migration startup process.
- Add persistent volumes.
- Add environment validation.
- Add structured logging.
- Add basic backup notes for Postgres.
- Add EC2 deployment guide:
  - Elastic IP
  - security groups
  - environment variables
  - Docker Compose commands
  - log inspection
  - restart procedure

### Deliverables

- App deploys on a single EC2 instance.
- Required operational docs exist.

---

## Initial Database Schema Plan

### Foundation

- `users`
- `sessions`
- `api_keys`
- `user_settings`
- `trading_preferences`
- `audit_logs`

### Provider Config

- `broker_accounts`
- `market_data_provider_configs`
- `research_provider_configs`
- `llm_provider_configs`

### AI/Research

- `daily_research_sessions`
- `research_sources`
- `market_regime_snapshots`
- `sector_bias_snapshots`
- `agent_runs`
- `agent_messages`
- `prompt_versions`
- `model_usage_logs`

### Trading

- `watchlist_items`
- `trade_candidates`
- `trigger_rules`
- `trigger_events`
- `approval_requests`
- `orders`
- `order_events`
- `gtt_candidates`
- `gtt_orders`
- `positions`
- `holdings_snapshots`
- `market_snapshots`

### Risk/RCA

- `risk_decisions`
- `trade_outcomes`
- `rca_reports`
- `rca_findings`
- `strategy_learnings`
- `notifications`

---

## MVP Endpoint Plan

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

---

## Safety-Critical Acceptance Criteria

Before any live execution feature is considered complete:

- Risk engine is mandatory for every order and GTT.
- Kill switch blocks all new automated action.
- YOLO mode cannot bypass risk checks.
- Every execution request has an idempotency key.
- Duplicate prevention is tested.
- API keys are encrypted at rest and never returned decrypted.
- Broker responses are stored.
- Every approval/rejection is audited.
- Every risk decision stores input, decision, reasons, rule version, timestamp, and `user_id`.
- No arbitrary code execution exists in trigger evaluation.

---

## Suggested First Coding Sprint

If starting implementation now, begin with Phase 0 + the first half of Phase 1:

1. Create independent `backend/` and `frontend/` project structure.
2. Create Elysia API app with health routes.
3. Create React + Vite web app.
4. Add Docker Compose for Postgres and Redis.
5. Add Drizzle DB package.
6. Add initial auth/settings schema.
7. Add encryption utility and env validation.
8. Add `.env.example`.

This gives a safe foundation before integrating Kite or automated trading workflows.
