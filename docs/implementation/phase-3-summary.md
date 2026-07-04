# Phase 3 Implementation Summary — AI Research Providers and Morning Research

## Scope

Implemented the first executable Phase 3 slice: provider interfaces/adapters, morning research orchestration, persistence, APIs, and a frontend research screen. Research output is deliberately non-executing; transient trade ideas remain session-level reasoning artifacts and generated GTT candidates remain drafts until later trigger, risk, approval, and execution phases are implemented.

## Backend Completed

- Added Phase 3 Drizzle schema and migration for:
  - `daily_research_sessions`
  - `research_sources`
  - `watchlist_items`
  - transient trade candidates in `daily_research_sessions.rawPlan`
  - `gtt_candidates`
- Added research provider abstractions:
  - `ResearchProvider`
  - `LlmProvider`
- Added adapters:
  - `ExaProvider`
  - `FinnhubProvider`
  - `OpenAiCompatibleProvider`
- Added morning research service:
  - loads broker holdings/positions context for exposure/risk context
  - gathers pre-market catalyst sources from Exa/Finnhub when keys are configured
  - uses the small model to classify catalyst type/direction/strength and extract explicit NSE equity symbols
  - ranks catalyst-backed likely movers instead of hardcoded/default symbols or after-the-fact top movers
  - calls OpenAI-compatible JSON LLM stages for ideas and grounded GTT drafts
  - persists session, sources, watchlist, transient trade reasoning, and GTT drafts
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
  - likely mover/catalyst candidates
  - transient trade reasoning
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
- Add dedicated exchange corporate-announcements and earnings-calendar providers.
- Add UI history for prior research sessions.
