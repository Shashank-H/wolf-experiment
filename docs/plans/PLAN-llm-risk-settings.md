# Plan: Pass Trading Risk Limits to the LLM and Remove Unwired Live Blockers

## Context

The current risk engine blocks live GTT approval when broker-actionable drafts are evaluated because two checks are intentionally unwired:

- `liquidity_spread_unavailable`
- `daily_loss_unavailable`

This does not match the intended product model for the current phase:

- The application only places/reviews two-leg Kite GTT drafts with target and stop-loss.
- The settings limits are primarily guardrails for the LLM while it creates GTT candidates for user review.
- The user is expected to approve/reject the candidate, so the limits should guide proposal generation rather than fully enforce broker-wide realized PnL or liquidity validation now.
- App-external losses/gains are out of scope.

## Approach

1. Pass saved trading preferences into the morning research/GTT LLM prompt context so the model can size and select GTT candidates using the user's configured limits.
2. Update the prompt wording so the LLM treats these as proposal constraints at GTT creation time:
   - daily loss = maximum planned loss/risk budget for GTT proposals, not broker-wide realized PnL monitoring
   - trades/day = maximum number of app-created trade/GTT proposals/orders for the day
   - capital/trade = maximum notional capital per candidate
   - open positions = maximum simultaneous app/broker positions to consider
3. Treat the four user-configured numeric trading limits as LLM-only for now: daily loss, trades/day, capital/trade, and open positions should guide candidate generation and user review, not block backend approval in this phase.
4. Remove or downgrade the current hard-blocking unwired checks for liquidity/spread and daily realized PnL in `evaluateRisk` so approving a GTT candidate is not blocked solely because those feeds are not wired.
5. Add TODO comments near the downgraded/LLM-only checks documenting future validation work:
   - app-specific planned-loss validation from entry/stop-loss/quantity
   - app-specific realized PnL tracking if needed later
   - app-specific trades/day, capital/trade, and open-position validation if/when backend enforcement is desired
   - optional liquidity/spread advisory checks from market data
6. Keep core safety validations in place: kill switch, symbol/strategy blacklist, pending approvals, duplicate prevention, fresh last-price requirement, and two-leg GTT bracket validation.

## Files to modify

- `backend/src/prompts/morning-research.ts`
  - Extend `MorningResearchSettings` or prompt context to include trading risk limits.
  - Add prompt lines for max daily loss, max trades/day, max capital/trade, max open positions.
  - Clarify that these are LLM proposal guardrails for draft GTT creation and manual review.

- `backend/src/services/research.ts`
  - Fetch `tradingPreferences` alongside user settings when building morning research context.
  - Pass the trading preferences into `buildMorningResearchIdeasMessages` and `buildMorningResearchGttMessages`.
  - Reuse existing parsing/clamping style used by `parseResearchSettings`.

- `backend/src/services/risk.ts`
  - Replace the hard `ok: false` unavailable checks for broker-actionable drafts with non-blocking informational checks, or remove them from failure-producing checks.
  - Downgrade `max_trades_per_day`, `max_open_positions`, and `max_capital_per_trade` from backend blockers to LLM-only/informational checks for now.
  - Add TODO comments for future app-specific planned-loss, numeric limit, and liquidity/spread validation.

- `frontend/src/pages/TradingSettingsPage.tsx`
  - Update help text for “Daily loss” to clarify it is currently an LLM/GTT proposal guardrail, not broker-wide realized PnL enforcement.

- `frontend/src/types.ts`
  - Update types only if the settings response shape changes.

## Reuse

- Existing settings persistence:
  - `backend/src/routes/settings.ts` already saves `maxDailyLoss`, `maxTradesPerDay`, `maxCapitalPerTrade`, and `maxOpenPositions` in `tradingPreferences`.
- Existing UI fields:
  - `frontend/src/pages/TradingSettingsPage.tsx` already exposes the trading limits.
- Existing LLM prompt construction:
  - `backend/src/prompts/morning-research.ts` already injects research settings via template replacement.
- Existing risk check inputs:
  - `backend/src/services/risk.ts` already reads max trades/day, open positions, and capital/trade, but these should become informational/LLM-only for this phase rather than backend blockers.
  - Keep reusing its kill switch, blacklists, pending approvals, and duplicate prevention checks as backend safety controls.
- Existing GTT safety validation:
  - `backend/src/services/execution.ts` already requires two-leg GTTs with target and stop-loss before broker placement.

## Steps

- [ ] Add a trading-risk-settings shape to the morning research prompt context.
- [ ] Load the current user's `tradingPreferences` in the research flow before prompt construction.
- [ ] Inject the trading limits into both Stage 1 and Stage 2 prompts. Stage 1 should use them to avoid unsuitable ideas early; Stage 2 should use them more strictly when sizing/selecting draft GTT candidates.
- [ ] Tell the LLM to prefer fewer/no candidates when it cannot fit within the configured proposal guardrails.
- [ ] Change `max_trades_per_day`, `max_open_positions`, and `max_capital_per_trade` from backend blockers to non-blocking informational checks, since the numeric limits are LLM-only for now.
- [ ] Change `daily_loss_unavailable` and `liquidity_spread_unavailable` from broker-action blockers to non-blocking informational checks, or remove them from `checks` entirely.
- [ ] Add TODOs in `risk.ts` for future validation:
  - [ ] calculate app-specific planned GTT loss from candidate price/stop-loss/quantity
  - [ ] optionally aggregate app-created GTT risk per day
  - [ ] optionally enforce app-specific trades/day, capital/trade, and open-position limits in backend
  - [ ] optionally add advisory liquidity/spread checks when bid/ask/depth data is available
- [ ] Update frontend copy for Daily loss to say it guides LLM GTT proposals/manual review rather than blocking on broker-wide realized daily PnL.
- [ ] Add/update tests if practical around prompt construction and/or risk decision behavior.

## Verification

- Run TypeScript/build checks for backend and frontend.
- Run existing tests:
  - `bun test`
- Manually verify settings flow:
  - Save trading limits in Trading settings.
  - Run morning research/GTT generation.
  - Confirm the LLM prompt/context includes the configured trading limits.
  - Confirm generated GTT drafts remain manual-review candidates.
- Manually verify GTT approval no longer fails only because liquidity/spread or realized PnL feeds are unwired.
- Confirm kill switch, blacklists, pending approvals, and duplicate prevention still block/flag as before.
- Confirm the four configured numeric limits are visible to the LLM but do not block backend approval by themselves in this phase.

## Questions / assumptions for review

- Assumption: for now, the daily loss field should be treated as a proposal-time LLM risk budget, not strict backend enforcement.
- Assumption: no immediate calculation of stop-loss-based max loss is required in this change; that should be left as a TODO.
- Assumption: liquidity/spread should not block GTT proposal or approval at this stage; it can become an advisory or validation feature later.
- Decision: include the numeric limits in both Stage 1 idea generation and Stage 2 GTT conversion. Stage 1 uses them as early filtering guidance; Stage 2 uses them as direct GTT proposal/sizing guidance.
- Decision: all four configured numeric limits are LLM-only for now: max daily loss, max trades/day, max capital/trade, and max open positions.
