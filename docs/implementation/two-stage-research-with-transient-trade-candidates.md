# Two-Stage Research Flow Without `trade_candidates` Table

## Summary

Rework morning research into a two-stage LLM pipeline:

1. Stage 1 generates watchlist, market thesis, risk warnings, and transient trade candidates.
2. Stage 2 takes the selected trade candidates from Stage 1 and generates persisted GTT drafts.

Trade candidates will not be stored in a dedicated DB table. They will live only inside the research session payload and agent conversation trace. The `trade_candidates` table and related schema references will be removed.

## Key Changes

### Backend behavior

- Split `runMorningResearch` into two explicit planning stages:
  - Stage 1 prompt returns `marketThesis`, `sectorBias`, `watchlist`, `tradeCandidates`, `riskWarnings`.
  - Stage 2 prompt consumes the Stage 1 result and returns `gttCandidates` only.
- Use a separate model call for Stage 2.
- Selection policy:
  - The model auto-selects which Stage 1 trade candidates advance to Stage 2.
  - Persisted GTT count is limited by `maxGttCandidates`.
  - Transient trade-candidate count is capped to a soft multiple of `maxGttCandidates`. Default: `3 x maxGttCandidates`, with a minimum floor so low GTT counts still allow a few ideas.
- Persist Stage 1 trade candidates only in:
  - `daily_research_sessions.rawPlan`
  - `daily_research_sessions.agentConversation`
- Persist only `gtt_candidates` rows as first-class execution drafts.

### Schema and data model

- Remove `tradeCandidates` from Drizzle schema and delete the `trade_candidates` table via migration.
- Remove `orders.trade_candidate_id` foreign key and column, since no persisted trade candidate record will exist.
- Remove any service queries, deletes, inserts, and summaries that depend on `trade_candidates`.
- Keep `gtt_candidates` unchanged as the only persisted actionable artifact from research.

### Prompts and types

- Replace the current single research schema with two schemas/types:
  - `MorningResearchIdeasPlan` for Stage 1
  - `MorningResearchGttPlan` for Stage 2
- Update provider types so `MorningResearchPlan` no longer implies persisted `tradeCandidates`; transient trade candidates should be represented as session-level plan data only.
- Remove `maxTradeCandidates` from:
  - prompt settings
  - backend settings parsing/validation
  - frontend settings forms/types
- Keep `maxGttCandidates` as the only candidate-count config in settings.

### API and UI surface

- `ResearchBundle` and day/history APIs should stop returning DB-backed `tradeCandidates` arrays.
- If transient trade candidates need to remain inspectable, read them from `session.rawPlan` or `session.agentConversation` only; do not add a first-class top-level response collection unless needed later.
- Keep user-facing visibility as agent log only for now.
- Remove today/history summary counts and UI copy that refer to persisted trade candidates.
- Keep research and GTT pages centered on:
  - watchlist
  - thesis and warnings
  - GTT drafts
  - agent conversation

## Test Plan

- Research run with LLM enabled:
  - Stage 1 produces transient trade candidates in session JSON.
  - Stage 2 produces persisted GTT rows only.
  - No `trade_candidates` DB writes occur.
- Research run with fallback path:
  - deterministic fallback still produces valid Stage 1 and Stage 2 session artifacts
  - GTT persistence still works
- Settings:
  - `maxTradeCandidates` is rejected or ignored and no longer stored
  - `maxGttCandidates` still limits persisted GTT output
- Hydration and summaries:
  - `/research/today`, `/research/:id`, `/today`, `/history` work without querying `trade_candidates`
  - day summary no longer includes persisted trade-candidate metrics
- Dry-run:
  - simulated order creation continues to use persisted GTT candidates only
  - no code path expects `tradeCandidateId`
- Migration safety:
  - schema migration drops `trade_candidates` and `orders.trade_candidate_id`
  - app boots and typechecks against the new schema

## Assumptions and defaults

- "Selected trade candidates" means model-selected, not user-selected.
- Trade candidates are transient reasoning artifacts, not approval objects.
- Visibility stays in `agentConversation` or session payload only; no dedicated UI section is added now.
- `maxTradeCandidates` is removed entirely from settings and prompt config.
- Transient trade-candidate cap defaults to `3 x maxGttCandidates`, adjusted with a small minimum floor during normalization.
