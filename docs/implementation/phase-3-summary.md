# Phase 3 Implementation Summary — AI Research Providers and Morning Research

## Scope

Implemented the first executable Phase 3 slice: provider interfaces/adapters, morning research orchestration, persistence, APIs, and a frontend research screen. Research output is deliberately non-executing; generated trade/GTT candidates remain drafts until later trigger, risk, approval, and execution phases are implemented.

## Backend Completed

- Added Phase 3 Drizzle schema and migration for:
  - `daily_research_sessions`
  - `research_sources`
  - `watchlist_items`
  - `trade_candidates`
  - `gtt_candidates`
- Added research provider abstractions:
  - `ResearchProvider`
  - `LlmProvider`
- Added adapters:
  - `ExaProvider`
  - `FinnhubProvider`
  - `OpenAiCompatibleProvider`
- Added morning research service:
  - loads broker holdings/positions context
  - gathers Exa/Finnhub sources when keys are configured
  - calls an OpenAI-compatible JSON LLM when configured
  - falls back to a deterministic conservative plan when keys/providers are unavailable
  - persists session, sources, watchlist, trade candidates, and GTT drafts
  - records audit events
- Added APIs:
  - `POST /research/run-morning`
  - `GET /research/today`
  - `GET /research/:id`
  - `GET /watchlist/today`
  - `POST /watchlist/manual`
  - `DELETE /watchlist/:id`

## Frontend Completed

- Added `/research` page and navigation entry.
- Morning Research UI includes:
  - run button
  - market thesis
  - sector bias
  - risk warnings
  - saved sources
  - trade candidates
  - GTT drafts
  - today watchlist
  - manual watchlist add/delete

## Validation

- `bun run typecheck` passes for backend and frontend.
- Drizzle migration generated: `backend/drizzle/0003_foamy_owl.sql`.

## Remaining Phase 3 Follow-up

- Add scheduled morning job runner.
- Add richer market-regime and sector-bias snapshot tables if needed beyond current JSON session fields.
- Add `agent_runs`, `agent_messages`, `prompt_versions`, and `model_usage_logs` for Langfuse-like internal tracing.
- Improve provider normalization for NSE/BSE symbols and Indian-market specific news sources.
- Add UI history for prior research sessions.
