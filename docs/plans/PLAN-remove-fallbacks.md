# Plan: Remove fallback and degraded-mode behavior

## Context

`docs/fallbacks.md` documents several places where Wolf silently degrades when providers, model output, broker state, market prices, or unfinished feeds are unavailable. The requested change is to remove those fallbacks so missing prerequisites fail explicitly instead of producing deterministic research, invented defaults, empty broker state, or placeholder risk passes.

This plan keeps existing safety gates that already fail closed and are not convenience fallbacks: dry-run/kill-switch live trading blocks, regular-order execution disablement, and the standard Kite API URL default.

## Approach

Replace soft fallbacks with explicit typed failures or explicit unavailable states:

- Research must require an LLM API key and valid LLM JSON.
- Research provider setup must require an LLM API key and at least one of Exa or Finnhub; if those preflight checks fail, the user should get an immediate error and the run should not start.
- LLM normalization must validate required fields and reject malformed/partial objects instead of filling invented values, with bounded retry/repair attempts for malformed LLM responses before the run is marked failed.
- The frontend home page must show missing LLM configuration as a blocking setup item, similar to the existing Kite expired/authentication prompts.
- GTT placement must require a fresh market snapshot price; no bracket-price substitution.
- Dry-run simulated orders should mirror the regular run lifecycle, except broker placement is not submitted; tracked paper orders must have real entry/current prices so end-of-day PnL reflects what would have happened live.
- Risk checks for unwired feeds must fail closed for broker-actionable flows rather than pass as placeholders.
- Broker GTT listing must not return `[]` for broker data when broker state is unknown.

For auditability, failures that happen after preflight passes, such as exhausted LLM repair retries or provider runtime errors after a run has started, can create/update a `dailyResearchSessions` row with `status: 'failed'`, `riskWarnings`/conversation error metadata, and no AI watchlist or GTT candidate persistence. Missing required setup should be blocked before starting the run.

## Files to modify

- `backend/src/services/research.ts`
- `backend/src/services/execution.ts`
- `backend/src/services/dry-run.ts`
- `backend/src/services/risk.ts`
- `backend/src/services/broker-sync.ts`
- `frontend/src/pages/OverviewPage.tsx`
- `frontend/src/pages/SettingsPage.tsx`
- Frontend research run trigger/UI that calls `/research/run-morning` if separate from `OverviewPage.tsx`
- `frontend/src/types.ts`
- `frontend/src/pages/GttPage.tsx`
- `docs/fallbacks.md`

## Reuse

Existing code and patterns to reuse:

- `dailyResearchSessions` persistence in `backend/src/services/research.ts` for completed session upsert; adapt it for failed-session audit rows.
- `AgentConversationTrace` shape in `backend/src/providers/research/types` and existing conversation metadata in `research.ts`; use a failed provider conversation instead of `fallbackConversation`.
- Existing `OpenAiCompatibleProvider.generateJsonWithConversation(...)` path in `research.ts`; wrap it with bounded retry/repair for malformed JSON/schema errors before failed research handling.
- `audit(...)` utility from `backend/src/utils/audit.ts` for recording failed/skipped outcomes.
- Existing market snapshot lookup helper `getLastMarketSnapshot(...)` in `backend/src/services/execution.ts`.
- Existing risk decision flow in `backend/src/services/risk.ts`; changing placeholder checks to `ok: false` already drives `decision: 'BLOCK'`.
- Existing frontend setup warning pattern in `frontend/src/pages/OverviewPage.tsx`, where Kite missing credentials and expired tokens are already surfaced on the home page.

## Steps

- [ ] **Research: remove deterministic plan generation**
  - Delete `fallbackPlan(...)`, `fallbackGttPlan(...)`, and `fallbackConversation(...)`.
  - Add a preflight check before `buildPlan(...)`: if `llmApiKey` is missing, throw a clear setup error and do not create a research session.
  - Remove all `deterministic-fallback` model/provider assignments.
  - Add failed-session handling only for failures that occur after required setup passes, with `status: 'failed'`, no watchlist rows, and no GTT candidate rows.

- [ ] **Research: enforce provider availability**
  - Require at least one configured research source provider: Exa or Finnhub.
  - If both Exa and Finnhub keys are missing, throw a clear user-facing setup error before starting morning research.
  - Change `collectSources(...)` to return both sources and provider errors/warnings.
  - If configured provider calls run but no source succeeds, fail the run with an explicit no-sources/provider-failed reason instead of generating from broker context only.

- [ ] **Research: replace permissive normalization with validation plus retry**
  - Make `normalizeIdeasPlan(...)` require `marketThesis`, `sectorBias`, and `watchlist` to be present and well-formed.
  - Permit `tradeCandidates` to be empty, but reject malformed candidates rather than inserting defaults such as `BUY`, `NSE`, or placeholder thesis text.
  - Make `normalizeGttPlan(...)` permit an empty `gttCandidates` array, but reject malformed GTT candidates instead of filling default exchange, side, quantity, or rationale.
  - Add a bounded retry mechanism around LLM calls: on invalid JSON or schema validation errors, send a repair prompt containing the validation errors and request only corrected JSON. After the retry budget is exhausted, mark the research session failed.

- [ ] **Execution: expose broker GTT unavailable state**
  - Update `listGttState(...)` so broker fetch failures or missing Kite credentials do not become `brokerGtts: []`.
  - Return an explicit status such as `brokerStatus: 'connected' | 'missing_credentials' | 'fetch_failed'` and `brokerGtts: null` when unknown.
  - Update callers/UI as needed if they assume `brokerGtts` is always an array.

- [ ] **Execution: require fresh last price for GTT placement**
  - Change `getLastPrice(...)` to only accept a valid market snapshot price.
  - Add a max-age check if `marketSnapshots.capturedAt` is available and suitable.
  - Throw `Fresh last price required before Kite GTT placement` when no valid snapshot exists.
  - Review `autoManageRevalidatedGtt(...)`, which currently uses `Math.max(targetPrice, stopLossPrice)` as a fallback for modify calls, and make broker modification fail or skip when last price is unavailable.

- [ ] **Dry-run: mirror regular runs without live broker placement**
  - In `runDryRunMorning(...)`, keep the same candidate lifecycle and tracking semantics as regular runs, but never submit orders to Kite.
  - Remove trigger/limit/zero entry-price fallback; paper trades must start from a real latest market price so EOD PnL answers “what profit/loss would I have made live?”
  - If a price is unavailable at the moment dry-run tracking would start, mark that candidate as waiting for market data rather than creating a zero-price order.
  - Update EOD dry-run reporting to clearly summarize hypothetical profit/loss for tracked paper trades and separately list any candidates that could not be tracked because pricing was unavailable.
  - Remove use of `dry_run_tracking_no_price` for newly created rows unless historical display compatibility requires retaining the label.

- [ ] **Risk: make unwired checks explicit hard blocks for live broker actions**
  - Clarification: until liquidity/spread and daily realized-PnL feeds are actually wired, live broker-actionable flows must be blocked by risk evaluation. This includes GTT approval, GTT auto-management, and any future live order path.
  - Change `liquidity_spread_placeholder` and `daily_loss_placeholder` to explicit unavailable checks with `ok: false` in live/broker-actionable evaluations.
  - Rename checks to something like `liquidity_spread_unavailable` and `daily_loss_unavailable`.
  - Keep research visibility and dry-run/paper-trading analysis possible, but do not allow unavailable risk feeds to be interpreted as passed checks for live action.

- [ ] **Broker sync: keep explicit credential failures**
  - Keep `syncPortfolio(...)`, `syncOrders(...)`, and `pollMarket(...)` returning `{ ok: false, reason: 'missing_kite_credentials' }` if callers depend on that stable API shape.
  - Do not reinterpret those responses as successful empty syncs.
  - Consider adding a typed error only for internal paths that require broker state for execution.

- [ ] **Frontend: surface missing research setup as blocking home-page items**
  - Update `frontend/src/pages/OverviewPage.tsx` so missing LLM API configuration is shown like Kite missing/expired setup, but without saying research will use fallback output.
  - Add the same kind of setup warning when both Exa and Finnhub are missing; the message should say at least one research source provider must be configured.
  - Disable or error clearly on the morning research start action when the LLM key is missing or both Exa/Finnhub are missing.
  - Add a clear call-to-action to configure the LLM provider and at least one research source provider in Settings before morning research can run.
  - Update Settings helper text if needed so users understand LLM is required and at least one of Exa/Finnhub is required.

- [ ] **Docs: rewrite fallback documentation**
  - Convert `docs/fallbacks.md` from a fallback inventory into a failure/safety behavior document.
  - Document removed behaviors and the new fail-closed/unavailable states.
  - Preserve documentation of intentional safety gates: dry-run, kill switch, disabled regular orders, and Kite API URL default.

## Verification

Run the normal project checks:

```bash
bun run typecheck
bun test
bun test backend/src
```

Manual checks:

- Start without an LLM key and attempt morning research: the UI/API should show a clear setup error and should not start the run.
- Start with both Exa and Finnhub missing and attempt morning research: the UI/API should show a clear setup error requiring at least one source provider.
- Try approving a GTT without a market snapshot: broker placement should be blocked before Kite API mutation.
- Future-facing note for the approval experience: when a new GTT candidate is surfaced or the approval window is opened, attach/show a fresh snapshot including current price, volume, and bearish/bullish signals for that stock.
- View the GTT screen with missing Kite credentials: local candidates/orders remain visible, broker state shows unavailable rather than empty.
- Run dry-run research and confirm paper trades are tracked like regular runs without actual broker placement, with EOD hypothetical profit/loss shown only for trades that had real market prices.
