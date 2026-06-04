# AI Trading Copilot — MVP Requirement Summary

## Product Goal

Build an AI-assisted trading copilot for Zerodha Kite that:

* researches the market before trading hours
* generates watchlists and trigger rules
* monitors markets using configurable polling
* optionally places GTTs/orders automatically in YOLO mode
* enforces deterministic risk checks
* stores all AI/trading decisions
* generates end-of-day RCA reports

The system is initially designed for a single user but architected for future multi-user support.

---

# MVP Scope

## Included in MVP

### Trading

* Indian equities only
* Intraday trading
* Swing trading
* GTT order workflows
* Manual approval mode
* Optional YOLO mode

### AI Features

* Morning market research
* AI-generated watchlists
* AI-generated trigger rules
* AI-generated GTT suggestions
* Market regime analysis
* EOD RCA analysis

### Risk Management

* Max daily loss
* Max capital per trade
* Max trades per day
* Max sector exposure
* Duplicate order prevention
* Cooldowns
* Liquidity/spread checks
* Kill switch

### Infrastructure

* Bun + Elysia backend
* React + Vite frontend
* PostgreSQL
* Redis
* BullMQ
* Docker Compose deployment on EC2

### Observability

* Langfuse integration
* AI trace storage
* Audit logs
* Prompt/model tracking

---

# Excluded From MVP

* Paper trading
* Replay/backtesting
* Multi-agent systems
* WebSockets/SSE
* Multi-user billing
* Mobile app
* Kubernetes
* Horizontal scaling
* External market data providers
* F&O
* Global markets
* Strategy marketplace

---

# Core User Flow

```txt
User configures APIs
    ↓
Morning research runs
    ↓
AI generates:
  - market thesis
  - watchlist
  - trigger rules
  - GTT suggestions
    ↓
Risk engine validates
    ↓
User approves OR YOLO mode auto-approves
    ↓
Polling engine monitors market
    ↓
Trigger engine evaluates rules
    ↓
Risk engine validates triggers
    ↓
Execution engine places orders/GTTs
    ↓
System stores all events
    ↓
EOD RCA runs
```

---

# Technical Stack

## Frontend

```txt
React
Vite
shadcn/ui
TanStack Query
```

## Backend

```txt
Bun
Elysia
Drizzle ORM
BullMQ
Redis
PostgreSQL
```

## Deployment

```txt
Docker Compose
EC2 with static IP
```

---

# Provider Architecture

All providers must use adapter-based architecture.

## Broker Provider

### MVP

* Zerodha Kite

### Future

* Multiple brokers
* Global markets

---

## Research Providers

### MVP

* Exa
* Finnhub

### Future

* Tavily
* Perplexity
* MarketAux
* Others

---

## LLM Providers

OpenAI-compatible provider architecture.

Support configurable:

* small model
* medium model
* big model

System should intelligently choose models based on task complexity.

---

# Trading Modes

## Manual Mode

User approval required before:

* order placement
* GTT placement

## YOLO Mode

System can:

* place GTTs automatically
* place trades automatically

YOLO mode still MUST:

* enforce risk engine
* enforce kill switch
* enforce audit logging

---

# Polling Engine

## Default Polling

Hourly.

## Configurable

User-configurable intervals:

* hourly
* 30 min
* 15 min
* 5 min
* custom

Polling should only monitor:

* active watchlist symbols
* active triggers
* open positions
* active GTT symbols

---

# Morning Research Agent

Runs before market open.

## Responsibilities

Generate:

* market regime
* sector bias
* watchlist
* trigger rules
* trade candidates
* GTT suggestions
* capital allocation suggestions
* no-trade recommendations

---

# Trigger Engine

## Requirements

* Deterministic rule evaluation
* JSON DSL only
* No arbitrary code execution
* Configurable trigger expiry
* Trigger lifecycle tracking

---

# Risk Engine

Every order and GTT must pass through risk validation.

## Mandatory Controls

```txt
daily loss limits
max trade size
max open positions
sector exposure
duplicate prevention
cooldowns
liquidity checks
kill switch
```

---

# GTT Workflow

## Manual Mode

```txt
AI suggests GTT
    ↓
Risk validation
    ↓
User approval
    ↓
Place GTT
```

## YOLO Mode

```txt
AI suggests GTT
    ↓
Risk validation
    ↓
Auto-place GTT
```

---

# End-of-Day RCA

System should analyze:

* winning trades
* losing trades
* thesis correctness
* trigger quality
* market regime mismatch
* risk engine effectiveness
* AI reasoning quality

All RCA outputs must be stored.

---

# Storage Requirements

Persist:

* AI outputs
* prompts
* model usage
* market snapshots
* trigger rules
* approvals
* orders
* GTTs
* risk decisions
* RCA reports
* audit logs

---

# Security Requirements

## API Keys

Must be:

* encrypted at rest
* user-specific
* never exposed to frontend after storage

## Auth

Local auth only for MVP.

---

# Observability Requirements

Use Langfuse for:

* prompt tracing
* model tracking
* token/cost tracking
* RCA traceability

---

# Notification Requirements

## MVP

* In-app notifications

## Optional Easy Integration

* Telegram bot

---

# Architecture Constraints

## Initial Deployment

* Single EC2 instance
* Docker Compose
* Same process can run API + workers

## Future-Ready Requirements

Architecture must support:

* multiple users
* multiple brokers
* multiple markets
* external market data providers
* separate worker containers later

---

# Non-Functional Requirements

## Reliability

* Persistent job queues
* Retry handling
* Idempotent order execution

## Auditability

* Every AI decision stored
* Every risk decision stored
* Every execution logged

## Extensibility

* Adapter-based provider system
* Modular services
* Multi-market-ready schema

## Safety

* No direct LLM order execution
* Risk engine mandatory
* Kill switch mandatory

---

# Recommended MVP Build Order

1. Monorepo + infra setup
2. Auth + encrypted settings
3. Kite integration
4. Polling engine
5. Morning research agent
6. Trigger engine
7. Risk engine
8. Approval workflow
9. GTT placement
10. YOLO mode
11. EOD RCA
12. Observability + analytics
