# AI Trading Copilot — Technical Architecture Documentation

## 1. Overview

AI Trading Copilot is a single-user-first, multi-user-ready trading assistant for Zerodha Kite.

The system performs morning market research, generates watchlists and trigger rules, monitors markets through configurable polling, manages risk, stores all trading decisions, and produces end-of-day RCA reports.

## Trading Safety Invariant

Wolf never places regular market/limit orders.

The only broker-side trading action allowed is placing, modifying, or cancelling Kite two-leg GTT orders that include both a target and a stoploss.

App triggers are internal workflow automations only. They must never directly call broker execution APIs.

The MVP is designed for Indian equities only, but the architecture must support future expansion to other brokers, asset classes, and global markets.

Failure and safety behavior is documented in [`docs/fallbacks.md`](./fallbacks.md). The guiding rule is that missing data, unavailable providers, or malformed model output must be explicit setup errors, runtime failures, unavailable states, or hard safety gates rather than silent fallback output.

---

## 2. Product Mode

### Initial Mode

Single user.

### Future Mode

Multi-user architecture-ready.

All core tables must include `user_id` even if only one user exists initially.

### Supported Instruments in MVP

Equities only.

### Future Instrument Support

* F&O
* Commodities
* Currency
* US equities
* China markets
* Japan markets
* Other broker integrations

---

## 3. High-Level Architecture

```txt
React + Vite + shadcn/ui
        ↓
Bun + Elysia REST API
        ↓
Application Services
        ↓
PostgreSQL + Redis
        ↓
Kite / Exa / Finnhub / OpenAI-compatible LLMs
```

### Runtime Stack

```txt
Frontend: React + Vite + shadcn/ui
Backend: Bun + Elysia
Queue/Jobs: BullMQ + Redis
Database: PostgreSQL
ORM: Drizzle
Auth: Local auth
Observability: Langfuse
Deployment: Docker Compose on EC2
```

---

## 4. Core Design Principles

1. AI should reason, not execute directly.
2. Deterministic code should handle polling, triggers, risk checks, order placement, and state transitions.
3. LLMs should be used for research, ranking, summarization, RCA, and contextual revalidation.
4. Every decision must be auditable.
5. All AI outputs must be stored.
6. Every real order must pass through the risk engine.
7. YOLO mode can skip approval but must never skip risk checks.
8. Broker, market data, research, and LLM providers must be adapter-based.

---

## 5. System Components

## 5.1 Frontend

### Tech

```txt
React
Vite
shadcn/ui
TanStack Query
React Hook Form
Zod
```

### Main Screens

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
Trading Settings
Agent Runs
EOD RCA
App Settings
```

### MVP Frontend Responsibilities

* Show morning research summary with dense details available in a right-side deep-dive drawer.
* Show generated watchlist.
* Show suggested trigger rules.
* Show pending GTT approvals.
* Show YOLO mode status.
* Approve/reject trades and GTTs.
* Display open positions.
* Display order state.
* Display risk warnings.
* Display RCA reports.
* Configure trading/risk preferences separately from app/provider settings.
* Surface missing provider keys or expired broker auth on the home page with a CTA to app settings.

---

## 5.2 Backend API

### Tech

```txt
Bun
Elysia
Drizzle ORM
PostgreSQL
Redis
BullMQ
```

### API Style

REST only for MVP.

No WebSockets/SSE initially.

Frontend should poll API endpoints for dashboard updates.

### Suggested Backend Modules

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

---

## 6. External Providers

## 6.1 Broker Provider

### MVP Broker

Zerodha Kite.

### Broker Adapter Interface

```ts
export interface BrokerAdapter {
  getProfile(): Promise<BrokerProfile>;

  getHoldings(): Promise<Holding[]>;
  getPositions(): Promise<Position[]>;
  getMargins(): Promise<MarginSnapshot>;

  getQuotes(symbols: InstrumentRef[]): Promise<Quote[]>;

  placeOrder(input: PlaceOrderInput): Promise<BrokerOrderResult>;
  modifyOrder(input: ModifyOrderInput): Promise<BrokerOrderResult>;
  cancelOrder(input: CancelOrderInput): Promise<void>;

  createGtt(input: CreateGttInput): Promise<BrokerGttResult>;
  modifyGtt(input: ModifyGttInput): Promise<BrokerGttResult>;
  cancelGtt(input: CancelGttInput): Promise<void>;

  getOrders(): Promise<BrokerOrder[]>;
  getGtts(): Promise<BrokerGtt[]>;
}
```

### Future Broker Implementations

```txt
KiteBrokerAdapter
PaperBrokerAdapter
InteractiveBrokersAdapter
AlpacaAdapter
UpstoxAdapter
GrowwAdapter
```

---

## 6.2 Market Data Provider

### MVP

Kite only.

### Future

External market data providers can be added later.

```ts
export interface MarketDataProvider {
  getQuotes(symbols: InstrumentRef[]): Promise<Quote[]>;
  getHistoricalCandles(input: CandleRequest): Promise<Candle[]>;
  getMarketStatus(exchange: string): Promise<MarketStatus>;
}
```

---

## 6.3 Research Providers

### MVP

```txt
Exa
Finnhub
Small-model catalyst classifier
Optional NSE mover confirmation/fallback
```

Morning research is **pre-market catalyst-first**. Exa and Finnhub collect broad and focused source evidence about likely movers, events, earnings, order wins, approvals, corporate actions, ratings, and sector/global cues. A small LLM classifies sources and extracts explicit NSE cash-equity symbols before the main research model runs.

NSE top gainers/losers are not primary pre-market discovery. `NseMarketMoverProvider` is retained only as explicit after-open/fallback confirmation when enabled.

### Research Adapter Interface

```ts
export interface ResearchProvider {
  search(input: ResearchSearchInput): Promise<ResearchResult[]>;
}

export interface MarketDiscoveryProvider {
  discover(input: MarketDiscoveryQuery): Promise<MarketCandidate[]>;
}
```

### Future Providers

```txt
Tavily
Perplexity
Alpha Vantage
MarketAux
Financial Modeling Prep
RSS feeds
Exchange filings/corporate announcements
Earnings calendars
Pre-open market data
```

---

## 6.4 LLM Provider

### Requirement

OpenAI-compatible API.

The user may configure multiple models:

```txt
big
medium
small
```

### Model Selection Strategy

```txt
small:
  classification
  JSON cleanup
  simple summarization
  trigger-time quick validation

medium:
  periodic research refresh
  trade thesis validation
  watchlist ranking

big:
  morning deep research
  complex RCA
  strategy review
  ambiguous market analysis
```

### LLM Adapter Interface

```ts
export interface LlmProvider {
  generateJson<T>(input: LlmJsonRequest): Promise<T>;
  generateText(input: LlmTextRequest): Promise<string>;
}
```

---

## 7. Job System

## 7.1 Why BullMQ

BullMQ is used for:

```txt
scheduled jobs
retries
delayed jobs
persistent job state
future worker separation
rate limiting
background AI calls
```

### MVP Mode

Same backend process can run both API and workers.

### Future Mode

Workers can be split into separate containers.

```txt
api
worker-research
worker-polling
worker-execution
worker-rca
```

---

## 7.2 Queues

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

### Important Jobs

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

---

## 8. Trading Modes

## 8.1 Normal Mode

User approval required before:

```txt
order placement
GTT placement
trade execution
```

## 8.2 YOLO Mode

User approval not required after morning analysis.

In YOLO mode:

```txt
morning research runs
agent generates GTT/order candidates
risk engine validates
system can place approved-by-policy two-leg Kite GTTs automatically
```

### YOLO Mode Still Requires

```txt
risk checks
daily loss limits
max capital limits
duplicate prevention
cooldowns
kill switch availability
audit logs
```

YOLO mode must never bypass the risk engine.

---

## 9. Morning Research Flow

### Schedule

Runs before market open.

Exact time configurable.

### Inputs

```txt
user risk preferences
symbol blacklist
previous RCA learnings
holdings/positions for exposure context
available capital
watchlist history
pre-market catalyst news
company/ticker news
sector news
global context
Kite quote/snapshot data for validation
optional reactive NSE mover confirmation
```

### Outputs

```txt
market regime
sector bias
daily watchlist
transient trade ideas in session payload
GTT suggestions only when price/risk grounded
risk warnings
capital allocation suggestion
no-trade recommendation if applicable
```

### Flow

```txt
morning_research job
    ↓
fetch user risk/context and broker state
    ↓
collect pre-market catalyst sources from Exa/Finnhub
    ↓
small model classifies catalyst type/direction/strength and extracts explicit NSE equity symbols
    ↓
normalize, dedupe, blacklist-filter, and rank likely-mover candidates
    ↓
enrich shortlisted candidates with Kite quote/snapshot data when available
    ↓
collect focused evidence for shortlisted candidates
    ↓
Stage 1 LLM generates thesis, sector bias, watchlist, and transient trade ideas
    ↓
Stage 2 LLM generates GTT drafts only for candidates with grounded price/risk context
    ↓
server validates schema, symbol grounding, and GTT price/risk requirements
    ↓
store daily_research_session, sources, watchlist_items, and pending_gtt_candidates
    ↓
notify user
```

Details and edge cases are documented in [`docs/implementation/pre-market-catalyst-research.md`](./implementation/pre-market-catalyst-research.md).

---

## 10. Polling Engine

### Default Frequency

Hourly.

### Configurable

Per user.

Examples:

```txt
hourly
30 min
15 min
5 min
1 min
custom cron
```

### Polling Scope

Only poll:

```txt
active watchlist symbols
open positions
active GTT-related symbols
active trigger symbols
```

### Polling Flow

```txt
market_poll job
    ↓
load active symbols
    ↓
batch fetch quotes from Kite
    ↓
store latest quotes in Redis
    ↓
persist selected market snapshots in Postgres
    ↓
enqueue trigger evaluation
```

### Redis Market Cache Example

```json
{
  "symbol": "NSE:INFY",
  "ltp": 1542.5,
  "changePercent": 1.24,
  "volume": 1200000,
  "updatedAt": "2026-06-04T10:15:00+05:30"
}
```

---

## 11. Trigger Engine

### Purpose

Evaluate deterministic rules created by the morning agent.

### Rule Format

LLM must output strict JSON DSL.

No arbitrary code execution.

### Trigger Rule Example

```json
{
  "logic": "AND",
  "conditions": [
    {
      "field": "ltp",
      "operator": "gt",
      "value": 1540
    },
    {
      "field": "changePercent",
      "operator": "gt",
      "value": 1.2
    }
  ]
}
```

### Supported Operators

```txt
gt
gte
lt
lte
eq
neq
between
crosses_above
crosses_below
```

### Supported Fields

```txt
ltp
changePercent
volume
volumeRatio
dayHigh
dayLow
open
previousClose
positionPnl
marketRegime
sectorBias
time
```

### Trigger States

```txt
draft
pending_approval
active
triggered
expired
cancelled
rejected
executed
```

---

## 12. Trigger-Time Research

### Status

TBD by product decision.

### Recommended MVP Behavior

Use configurable policy.

```txt
never
always
only_high_risk
only_high_capital
only_large_move
```

### Recommended Default

```txt
only_high_risk
```

Trigger-time research should answer:

```txt
Has anything materially changed since the morning thesis?
```

Not:

```txt
Should we randomly rethink the whole trade?
```

---

## 13. GTT Flow

## 13.1 Normal Mode

```txt
morning agent creates GTT suggestions
    ↓
risk engine validates
    ↓
user sees pending GTTs on dashboard
    ↓
user approves/rejects
    ↓
system places approved GTTs via Kite
```

## 13.2 YOLO Mode

```txt
morning agent creates GTT suggestions
    ↓
risk engine validates
    ↓
system places GTTs automatically
```

## 13.3 GTT Revalidation

Periodic GTT revalidation checks:

```txt
stale thesis
changed market regime
negative news
price moved too far away
expired setup
daily risk limit breached
```

Possible actions:

```txt
keep
cancel
flag_for_review
```

---

## 14. Risk Engine

Risk engine is mandatory before any order or GTT.

### MVP Risk Controls

```txt
max daily loss
max trades per day
max capital per trade
max open positions
max sector exposure
cooldown between trades
duplicate order prevention
symbol blacklist
strategy blacklist
market regime filter
minimum liquidity/spread check
max active GTTs
max pending approvals
```

### Risk Result

```ts
type RiskDecision =
  | "APPROVED"
  | "REJECTED"
  | "NEEDS_USER_APPROVAL"
  | "NEEDS_RESEARCH_REVALIDATION";
```

### Risk Audit

Every risk decision must store:

```txt
input
decision
reasons
risk rule versions
timestamp
user_id
trade_candidate_id
```

---

## 15. Execution Engine

### Responsibilities

```txt
place two-leg Kite GTTs with target + stoploss
modify two-leg Kite GTTs with target + stoploss
cancel Kite GTTs
never place/modify/cancel regular market or limit orders
sync order status
sync positions
handle rejection
store broker responses
```

### Order Lifecycle

```txt
created
risk_validated
pending_approval
approved
submitted
open
partially_filled
filled
cancelled
rejected
failed
```

### Execution Guardrails

```txt
idempotency keys
duplicate prevention
broker response logging
rate-limit protection
retry only when safe
never place or retry regular market/limit orders
```

---

## 16. End-of-Day RCA Agent

### Schedule

After market close.

Configurable.

### Inputs

```txt
morning research session
watchlist items
trigger rules
GTTs
orders
positions
market snapshots
news snapshots
AI decisions
risk decisions
PnL
manual overrides
```

### Outputs

```txt
daily summary
trade-level RCA
strategy-level RCA
agent reasoning review
risk review
recommended improvements
prompt improvement suggestions
```

### RCA Categories

```txt
thesis correct / incorrect
entry timing good / bad
trigger too early / late
stop-loss too tight / loose
target realistic / unrealistic
market regime mismatch
news changed thesis
risk engine prevented loss
user override impact
```

---

## 17. Data Storage

## 17.1 Database

PostgreSQL.

All tables should include:

```txt
id
user_id
created_at
updated_at
```

where relevant.

---

## 17.2 Suggested Tables

### Users/Auth

```txt
users
sessions
api_keys
user_settings
trading_preferences
```

### Provider Config

```txt
broker_accounts
market_data_provider_configs
research_provider_configs
llm_provider_configs
```

### Research

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
transient trade candidates in daily_research_sessions.rawPlan
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

### Risk/RCA

```txt
risk_decisions
trade_outcomes
rca_reports
rca_findings
strategy_learnings
audit_logs
```

---

## 18. Encryption

API keys must be encrypted at rest.

### Secrets to Encrypt

```txt
Kite API key
Kite access token
Exa API key
Finnhub API key
OpenAI-compatible API keys
Telegram bot token
```

### Recommended Approach

Use envelope encryption.

MVP can use:

```txt
APP_ENCRYPTION_KEY
AES-256-GCM
```

Store:

```txt
encrypted_value
iv
auth_tag
key_version
```

Future:

```txt
AWS KMS
HashiCorp Vault
```

---

## 19. Local Auth

### MVP Auth

Local email/password login.

### Requirements

```txt
bcrypt/argon2 password hashing
httpOnly cookies
CSRF protection if cookie-based
session expiry
password reset later
```

Since this is initially personal-use, auth can be simple but should not be skipped.

---

## 20. Observability

### Langfuse

Use Langfuse for:

```txt
LLM traces
prompt versions
model usage
latency
cost tracking
AI output inspection
RCA traceability
```

### Application Logs

Store structured logs for:

```txt
job execution
broker calls
risk decisions
order submissions
GTT submissions
errors
```

### Audit Logs

Audit logs are mandatory for:

```txt
login
settings change
API key change
YOLO mode enable/disable
order placed
GTT placed
risk override
approval/rejection
kill switch activation
```

---

## 21. Notifications

### MVP

In-app notifications.

### Easy Integration

Telegram via BotFather.

### Notification Events

```txt
morning research ready
pending approvals
GTT placed
trigger hit
order placed
order rejected
risk limit breached
YOLO action executed
EOD RCA ready
```

---

## 22. Deployment

### MVP Deployment

Docker Compose on EC2.

### Services

```txt
app
postgres
redis
```

Initially, `app` can run API and workers in the same process.

### Future Split

```txt
api
worker
postgres
redis
```

### Static IP

EC2 Elastic IP should be used for stable outbound Kite order placement.

---

## 23. Monorepo Structure

```txt
ai-trading-copilot/
  apps/
    web/
      src/
    api/
      src/
  packages/
    shared/
    db/
    config/
    types/
    eslint-config/
  infra/
    docker/
    docker-compose.yml
  docs/
    architecture.md
    api.md
    trigger-dsl.md
    risk-engine.md
```

---

## 24. Backend Folder Structure

```txt
apps/api/src/
  main.ts
  app.ts

  modules/
    auth/
    users/
    settings/
    broker/
    market-data/
    research/
    llm/
    watchlist/
    triggers/
    risk/
    orders/
    gtt/
    portfolio/
    approvals/
    notifications/
    rca/
    audit/
    jobs/

  providers/
    broker/
      BrokerAdapter.ts
      KiteBrokerAdapter.ts
    research/
      ResearchProvider.ts
      ExaProvider.ts
      FinnhubProvider.ts
    llm/
      LlmProvider.ts
      OpenAiCompatibleProvider.ts
    market-data/
      MarketDataProvider.ts
      KiteMarketDataProvider.ts

  queues/
    queue-names.ts
    queue-registry.ts
    processors/

  db/
    schema/
    migrations/

  utils/
    crypto.ts
    idempotency.ts
    time.ts
```

---

## 25. MVP API Endpoints

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
PUT  /settings/research
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
GET /watchlist/today
POST /watchlist/manual
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

---

## 26. MVP Job Schedule

```txt
morning_research:
  before market open

market_poll:
  hourly by default, configurable

gtt_revalidation:
  configurable, suggested every 30-60 min

sync_orders:
  configurable, suggested every 5-15 min during market hours

sync_positions:
  configurable, suggested every 5-15 min during market hours

eod_rca:
  after market close
```

---

## 27. Critical Safety Controls

### Kill Switch

User must be able to instantly:

```txt
pause all polling
disable YOLO mode
cancel pending internal triggers
optionally cancel active GTTs
block new orders
```

### YOLO Warning

Enabling YOLO mode should require explicit confirmation.

### Duplicate Prevention

Every generated order/GTT must use an idempotency key.

Example:

```txt
user_id + date + symbol + strategy_id + action + trigger_rule_id
```

### No LLM Direct Execution

LLM outputs proposals only.

Execution engine only accepts validated internal objects.

---

## 28. Open TBD Decisions

### Trigger-Time Research Policy

Current status: TBD.

Recommended default:

```txt
only_high_risk
```

Options:

```txt
never
always
only_high_risk
only_high_capital
only_large_move
```

### UI Style

Not specified.

Recommended MVP:

```txt
modern dashboard
desktop-first
mobile-readable
```

### Paper Trading / Replay

Later.

Architecture should still include `PaperBrokerAdapter` interface but implementation can be postponed.

---

## 29. MVP Boundary

### Must Have

```txt
local auth
encrypted API keys
Kite broker adapter
Exa/Finnhub research adapters
OpenAI-compatible LLM adapter
morning research agent
watchlist generation
trigger rule generation
configurable polling
risk engine
approval workflow
GTT candidate flow
YOLO mode
order/GTT execution via Kite
basic portfolio sync
audit logs
Langfuse tracing
EOD RCA
Docker Compose deployment
```

### Not MVP

```txt
multi-user billing
paper trading
replay engine
multi-agent debate
mobile app
WebSockets/SSE
external market data provider
F&O
US markets
broker marketplace
strategy marketplace
Kubernetes
horizontal scaling
```

---

## 30. Recommended Implementation Order

### Phase 1 — Foundation

```txt
monorepo setup
Elysia API
React app
Postgres + Drizzle
Redis
BullMQ setup
local auth
encrypted provider config
```

### Phase 2 — Broker + Data

```txt
Kite adapter
holdings/positions sync
quote polling
market cache
order sync
```

### Phase 3 — AI Research

```txt
LLM adapter
Exa adapter
Finnhub adapter
morning research job
daily research dashboard
watchlist generation
```

### Phase 4 — Trigger + Risk

```txt
trigger DSL
trigger evaluator
risk engine
approval workflow
audit logs
```

### Phase 5 — GTT + Execution

```txt
GTT candidates
approval flow
YOLO mode
Kite GTT placement
order placement
execution logs
```

### Phase 6 — RCA + Observability

```txt
Langfuse tracing
EOD RCA
trade outcomes
strategy learnings
dashboard analytics
```

---

## 31. Final Architecture Summary

```txt
User logs in
    ↓
Configures Kite, Exa, Finnhub, LLM keys
    ↓
Morning research job runs
    ↓
Agent creates market thesis, watchlist, triggers, GTT candidates
    ↓
Risk engine validates
    ↓
User approves manually or YOLO mode proceeds
    ↓
Polling engine tracks symbols
    ↓
Trigger engine evaluates rules
    ↓
Risk engine validates triggered signals
    ↓
Execution engine places/modifies/cancels only two-leg Kite GTTs
    ↓
System stores every decision and event
    ↓
EOD RCA agent analyzes performance
    ↓
Learnings feed future research context
```

The MVP should be positioned as an AI trading copilot, not a fully autonomous black-box trading bot.
