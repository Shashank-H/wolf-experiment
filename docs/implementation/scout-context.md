# Code Context

## Files Retrieved
1. `docs/MVP.md` (lines 1-260) - product goal, MVP scope/exclusions, core flow, mandated stack, provider architecture, trading modes, polling, morning research responsibilities.
2. `docs/architecture.md` (lines 1-430) - technical architecture, core principles, frontend/backend modules, adapter interfaces, BullMQ queues/jobs, YOLO/manual constraints.
3. `docs/architecture.md` (lines 431-760) - morning research flow, polling flow, Trigger JSON DSL, trigger-time research policy, GTT flow, risk decision shape/audit fields.
4. `docs/architecture.md` (lines 756-1040) - execution guardrails, EOD RCA inputs/outputs, database table groups, encryption, auth, Langfuse observability.
5. `docs/implementation-plan.md` (lines 1-735) - confirmed decisions, phased implementation plan, schema/endpoint plans, safety acceptance criteria, suggested first coding sprint.

## Key Code
No application code exists yet. Repository currently contains only documentation plus an existing `docs/implementation/progress.md`; `git status --short` shows `?? docs/implementation/`, so implementation docs are untracked. No `backend/`, `frontend/`, `infra/`, package files, or Docker Compose files are present.

Critical requirements from docs:

```txt
Product: AI trading copilot for Zerodha Kite, Indian equities only, intraday/swing/GTT workflows.
Modes: manual approval mode and optional YOLO mode.
Safety: every order/GTT must pass deterministic risk checks; YOLO cannot bypass risk/kill switch/audit logging.
Stack: Bun + Elysia backend, React + Vite frontend, Drizzle ORM, PostgreSQL, Redis, BullMQ, Docker Compose on EC2, Langfuse.
API style: REST only; no WebSockets/SSE for MVP; frontend polls REST endpoints.
Provider style: adapter-based broker, market data, research, LLM providers.
Auth/secrets: local email/password auth, httpOnly sessions, encrypted API keys via AES-256-GCM and APP_ENCRYPTION_KEY.
```

Important interfaces/DSL from architecture:

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

export interface MarketDataProvider {
  getQuotes(symbols: InstrumentRef[]): Promise<Quote[]>;
  getHistoricalCandles(input: CandleRequest): Promise<Candle[]>;
  getMarketStatus(exchange: string): Promise<MarketStatus>;
}

export interface ResearchProvider {
  search(input: ResearchSearchInput): Promise<ResearchResult[]>;
  getTickerNews(input: TickerNewsInput): Promise<NewsItem[]>;
  getMarketNews(input: MarketNewsInput): Promise<NewsItem[]>;
}

export interface LlmProvider {
  generateJson<T>(input: LlmJsonRequest): Promise<T>;
  generateText(input: LlmTextRequest): Promise<string>;
}
```

Trigger DSL constraints:

```json
{
  "logic": "AND",
  "conditions": [
    { "field": "ltp", "operator": "gt", "value": 1540 },
    { "field": "changePercent", "operator": "gt", "value": 1.2 }
  ]
}
```

Allowed operators: `gt`, `gte`, `lt`, `lte`, `eq`, `neq`, `between`, `crosses_above`, `crosses_below`. Allowed fields include `ltp`, `changePercent`, `volume`, `volumeRatio`, `dayHigh`, `dayLow`, `open`, `previousClose`, `positionPnl`, `marketRegime`, `sectorBias`, `time`. No arbitrary code execution.

Risk decisions:

```ts
type RiskDecision =
  | "APPROVED"
  | "REJECTED"
  | "NEEDS_USER_APPROVAL"
  | "NEEDS_RESEARCH_REVALIDATION";
```

Every risk decision must store input, decision, reasons, risk rule versions, timestamp, `user_id`, and trade candidate reference where relevant.

## Architecture
Current project state:
- Empty implementation repository: docs-only at root (`docs/MVP.md`, `docs/architecture.md`, `docs/implementation-plan.md`).
- No backend/frontend/infra scaffolding exists yet.
- Therefore the requested implementation should start from repository bootstrap, not feature work.

Mandated technology choices:
- Frontend: React, Vite, shadcn/ui, TanStack Query; architecture also names React Hook Form and Zod.
- Backend: Bun, Elysia, Drizzle ORM, PostgreSQL, Redis, BullMQ.
- Deployment: Docker Compose on a single EC2 instance with static/Elastic IP.
- Providers: Zerodha Kite for broker and MVP market data; Exa + Finnhub for research; OpenAI-compatible LLM provider with configurable `small`, `medium`, `big` models.
- Observability: Langfuse for LLM traces, prompt versions, model usage, latency, cost, RCA traceability.
- Auth/security: local email/password auth, session cookies, encrypted API keys at rest via AES-256-GCM.

Data flow:
1. User configures provider credentials and trading/risk preferences.
2. Morning research job fetches broker state, Exa/Finnhub news/research, Kite quotes, then calls LLM for structured daily plan.
3. Backend validates/persists AI output, creates watchlist items, trigger rules/drafts, GTT candidates, and notifications.
4. Polling job loads active symbols, gets Kite quotes, caches in Redis, stores selected market snapshots in Postgres, then enqueues trigger evaluation.
5. Trigger engine evaluates deterministic JSON DSL only.
6. Risk engine validates every candidate/order/GTT.
7. Manual mode creates approvals; YOLO mode may auto-place only after risk approval and kill-switch checks.
8. Execution engine uses Kite adapter, idempotency keys, duplicate prevention, safe retry rules, and stores broker responses/events.
9. EOD RCA job loads thesis/trades/triggers/GTTs/orders/market snapshots/risk decisions/PnL, calls LLM, persists report/findings/learnings, and notifies user.

Major implementation phases from `docs/implementation-plan.md`:
- Phase 0: repository bootstrap with independent `backend/` and `frontend/`, TypeScript configs, root Bun scripts, `.env.example`, Docker Compose for Postgres/Redis.
- Phase 1: Elysia API, health/ready endpoints, Drizzle/Postgres, users/sessions/api_keys/settings/trading_preferences/audit_logs, local auth, AES-256-GCM encryption, settings UI.
- Phase 2: Kite broker/market-data adapters, broker/portfolio/order schemas, BullMQ queues, Redis quote cache, portfolio/orders UI.
- Phase 3: Exa/Finnhub/OpenAI-compatible adapters, model tiers, daily research schemas, morning research job/APIs/UI.
- Phase 4: Trigger DSL validator/evaluator, risk engine, approvals, kill switch, trigger-time research default `only_high_risk`.
- Phase 5: GTT and order execution with idempotency, duplicate prevention, safe retries, GTT revalidation, YOLO/manual flows.
- Phase 6: EOD RCA, Langfuse, notifications, agent run visibility.
- Phase 7: production Dockerfile, production Compose, migration startup, volumes, env validation, logging, backups, EC2 guide.

Likely first milestone:
- Implement Phase 0 plus the first half of Phase 1 exactly as suggested by the docs: create independent backend/frontend projects, Elysia health routes, Vite app, Docker Compose for Postgres/Redis, Drizzle setup, initial auth/settings schema, encryption utility, environment validation, `.env.example`, and root scripts.
- This milestone should deliberately avoid Kite, LLM, research, YOLO automation, and live execution until auth/secrets/audit foundations are in place.

Likely files/directories to create first:
- `package.json` root with Bun scripts.
- `backend/package.json`, `backend/tsconfig.json`, `backend/src/index.ts`, `backend/src/env.ts`, `backend/src/db/*`, `backend/src/auth/*`, `backend/src/settings/*`, `backend/src/crypto/*`, `backend/drizzle/`.
- `frontend/package.json`, `frontend/tsconfig.json`, `frontend/src/*`, Vite config, minimal auth/settings screens.
- `infra/docker-compose.yml` for postgres/redis.
- `.env.example`.

## Start Here
Open `docs/implementation-plan.md` first, especially lines 25-149 and 720-733. It is the actionable build order and explicitly says to start with Phase 0 + first half of Phase 1 before broker/AI/trading automation.

## Ambiguities / User Decisions Needed
- Exact package setup: single root Bun workspace vs simple root scripts invoking independent `backend/` and `frontend/` packages. Docs require independence and root scripts, but not workspace mechanics.
- Password hashing library: Argon2 or bcrypt are allowed; user may prefer one.
- Frontend styling depth: docs say shadcn/ui but implementation plan says minimal utility UI optimized for speed; decide how much shadcn setup is required in milestone 1.
- Session/CSRF specifics: architecture requires httpOnly cookies and CSRF if cookie-based, but exact cookie/session library and CSRF approach are not specified.
- Environment variable names beyond `APP_ENCRYPTION_KEY` are not fully enumerated; `.env.example` needs a sensible proposed set.
- Kite auth flow/token lifecycle details are not specified and can wait until Phase 2.
- Trigger-time research is marked TBD in architecture, though implementation plan confirms default `only_high_risk`; treat as configurable unless user revises.
- Market hours/timezone assumptions are implied for India/Kite but exact schedules are not specified.
- Testing framework is not mandated; choose Bun test unless user wants Vitest/Playwright/etc.

## Suggested Validation Commands
Initial milestone validation should include:

```sh
bun install
bun run typecheck
bun run dev:backend
bun run dev:frontend
bun run db:generate
bun run db:migrate
docker compose -f infra/docker-compose.yml up -d postgres redis
curl http://localhost:<backend-port>/health
curl http://localhost:<backend-port>/ready
```

Once auth/settings exist, add smoke checks for:

```sh
curl -i -X POST http://localhost:<backend-port>/auth/register ...
curl -i -X POST http://localhost:<backend-port>/auth/login ...
curl -i http://localhost:<backend-port>/auth/me ...
curl -i -X PUT http://localhost:<backend-port>/settings/providers ...
```

Safety-critical validation to plan before live execution phases:
- Unit tests for encryption/decryption and refusal to return decrypted API keys.
- Unit tests for risk decisions, kill switch, duplicate prevention, and idempotency.
- Unit tests for trigger DSL validation/evaluation proving arbitrary code cannot execute.
- Integration tests with mocked Kite provider before any live broker calls.
