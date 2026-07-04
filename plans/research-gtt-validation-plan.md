# Research GTT Validation and Finnhub Cleanup Plan

## Context

Recent morning research runs fetched source material but produced no shortlisted GTTs, and one run failed because the LLM returned symbols that were not grounded in discovered candidates, broker context, or source symbols. DB inspection showed Finnhub broad discovery is not useful for this workflow because `FinnhubProvider.search()` ignores `query` when no `symbols` are provided and falls back to generic `/news?category=general` results.

The intended outcome is:

- Remove Finnhub from broad catalyst discovery.
- Keep grounded-symbol validation for actionable trade/GTT candidates, but treat ungrounded actionable ideas as expected filtered candidates rather than a session-failing error.
- Allow watchlist items to include ungrounded symbols because no action is taken from watchlist entries; they are informational only.
- Keep GTT output strict: only GTTs with discovered candidate price context should persist.
- Record filtered actionable symbols as validation notes in the plan/session trace, not as provider warnings or hard failures.

## Approach

Update the research service so broad source collection uses natural-language/search-capable discovery paths only, primarily Exa and existing NSE/broker/snapshot discovery. Finnhub should not be called with a broad natural-language query.

Change Stage 1 idea normalization so unsupported `tradeCandidates` are removed from the returned plan instead of causing `Invalid ideas research JSON`. Keep `watchlist` permissive: watchlist items may be ungrounded because they are informational and do not create orders or candidate rows. The validation should still fail for structural/schema errors, invalid fields, or malformed JSON. Filtered actionable symbols should be surfaced as notes for observability.

Change Stage 2 GTT normalization similarly: when a candidate lacks discovered price/reference context, drop that GTT candidate instead of throwing solely for grounding/price-context mismatch. Continue to fail for structurally invalid GTT JSON or invalid prices/quantities/transaction shape.

## Files to modify

- `backend/src/services/research.ts`
  - Remove broad Finnhub tasks from source collection paths.
  - Add candidate-level filtering for ungrounded Stage 1 `tradeCandidates` only; do not filter `watchlist` for grounding.
  - Add candidate-level filtering for GTT candidates without discovered price context.
  - Add validation-note plumbing into plan/session trace.
  - Extend `__researchDiscoveryTestHooks` if needed for focused tests.
- `backend/src/services/research-discovery.test.ts`
  - Update existing GTT price-context test expectations.
  - Add tests for ungrounded Stage 1 filtering.
  - Add tests proving broad source collection does not call Finnhub without symbols.
- Potentially `backend/src/prompts/morning-research.ts`
  - Small wording tweak only if needed to align model instructions with filter behavior; keep the existing “do not invent symbols” guidance.

## Reuse

- `collectSources(...)` in `backend/src/services/research.ts`
  - Existing broad/focused source orchestration.
- `allowedResearchSymbols(...)` in `backend/src/services/research.ts`
  - Existing trusted-symbol set from broker context, discovered candidates, and source symbols.
- `normalizeIdeasPlan(...)` in `backend/src/services/research.ts`
  - Existing Stage 1 schema normalization and grounding check.
- `normalizeGttPlan(...)` in `backend/src/services/research.ts`
  - Existing Stage 2 schema normalization and price-context filtering.
- `deriveIdeasThoughtDetails(...)` / `deriveGttThoughtDetails(...)` in `backend/src/services/research.ts`
  - Existing trace surface for notes about how many items survived validation.
- `__researchDiscoveryTestHooks` in `backend/src/services/research.ts`
  - Existing test surface for pure validation/discovery helper tests.

## Steps

- [ ] Remove the broad Finnhub task in `collectSources(...)` when `input.candidates.length === 0`.
- [ ] Remove the earlier broad Finnhub task used before provider settling, if it is part of the no-candidate broad discovery path.
- [ ] Keep or leave untouched the symbol-specific Finnhub path for now only if it is already behind `symbols: [candidate.tradingsymbol]`; do not add new focused Finnhub work.
- [ ] Introduce a lightweight validation-notes structure, e.g. `validationNotes: string[]`, on the in-memory `MorningResearchPlan` or conversation trace. Avoid calling these provider warnings.
- [ ] In `normalizeIdeasPlan(...)`, split schema/field errors from actionable-candidate grounding filters:
  - [ ] Normalize all items as today.
  - [ ] Leave `watchlist` items intact even when their symbols are not in `allowedSymbols`, because watchlist is informational only.
  - [ ] Drop only `tradeCandidates` whose `tradingsymbol` is not in `allowedSymbols`.
  - [ ] Add a note listing dropped actionable symbols and the reason.
  - [ ] Do not throw only because actionable symbols were dropped.
  - [ ] Still throw when required structural fields are missing/invalid.
- [ ] Keep the existing watchlist requirement focused on schema/product completeness, not grounding; an ungrounded watchlist item can satisfy the watchlist requirement.
- [ ] In `normalizeGttPlan(...)`, keep validating candidate shape/prices/quantity, but drop candidates missing discovered `lastPrice` or `referencePrice` instead of throwing solely for missing price context.
- [ ] Add notes to `deriveIdeasThoughtDetails(...)` and `deriveGttThoughtDetails(...)` so the UI/session trace can show filtered candidates as normal validation results.
- [ ] Ensure persisted `riskWarnings` remain focused on actual risk/source/provider issues, not routine validation drops.
- [ ] Update tests in `backend/src/services/research-discovery.test.ts`:
  - [ ] Existing “rejects GTT candidates when discovered candidate price context is missing” should become “drops GTT candidates...” and expect `[]`.
  - [ ] Add a Stage 1 test where one grounded and one ungrounded `tradeCandidate` are returned; expect only grounded trade candidate survives.
  - [ ] Add a Stage 1 test where watchlist contains an ungrounded symbol; expect the watchlist item remains.
  - [ ] Add a Stage 1 test where all `tradeCandidates` are ungrounded; expect no hard failure if the rest of the JSON is structurally valid.
  - [ ] Add a collect-sources test proving Finnhub is not called for broad/no-symbol discovery even when `finnhubApiKey` exists.
- [ ] Run formatting/type/test checks.

## Verification

- Run backend tests:
  ```bash
  cd backend && bun test
  ```
- Run backend typecheck:
  ```bash
  cd backend && bun run typecheck
  ```
- Manual dry-run verification:
  - Run morning research with Finnhub key absent.
  - Confirm the session completes when the LLM emits ungrounded actionable ideas.
  - Confirm `raw_plan.gttCandidates` contains only price-grounded candidates, or `[]`.
  - Confirm session trace includes validation notes for dropped symbols.
  - Confirm `providerWarnings` does not include routine dropped-symbol notes.
- DB verification queries:
  ```sql
  select status, risk_warnings, raw_plan->'gttCandidates', agent_conversation->'thoughtDetails'
  from daily_research_sessions
  order by created_at desc
  limit 1;
  ```
