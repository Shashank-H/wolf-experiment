# Failure and Safety Behavior

Wolf is a trading copilot. Missing prerequisites, unknown broker state, malformed model output, or stale market data must be made explicit instead of being converted into deterministic research, invented defaults, empty broker output, or zero-price tracking rows.

## Principles

1. **Do not invent trading context.** If required provider data or model output is unavailable, the system must say what is missing instead of manufacturing a plan.
2. **Fail before broker authority increases.** Any path that can mutate broker state must require fresh, validated inputs.
3. **Keep unknown state distinct from empty state.** “Broker unavailable” is different from “broker returned zero GTTs.”
4. **Make setup blockers visible.** Required research and broker setup errors should be user-facing, especially on the home page and action surfaces.
5. **Preserve intentional safety gates.** Dry-run mode, kill switch, and regular-order disablement remain hard safety controls.

## Current failure behavior

| Area | Behavior | User/audit outcome |
| --- | --- | --- |
| Morning research setup | Morning research requires a configured LLM API key. If the LLM key is missing, the run does not start and returns a clear setup error. | No deterministic research session, watchlist, or GTT candidates are generated. The UI should prompt the user to configure the LLM provider. |
| Research source setup | At least one research source provider must be configured: Exa or Finnhub. If both keys are missing, morning research does not start. | The user receives a setup error requiring at least one source provider. Broker context alone is not treated as fresh research. |
| Research provider runtime failures | If configured source providers run but no external source succeeds, the research run fails explicitly instead of continuing from portfolio context only. | The failed reason is recorded in warnings/error metadata where a session has already started; no AI watchlist or GTT candidate rows are persisted from failed research. |
| Malformed or partial LLM output | LLM output is validated against required fields. Malformed JSON or schema errors get bounded repair/retry attempts. If retry budget is exhausted, the run fails. | The system records the validation/retry failure. It does not fill missing fields with neutral bias, default symbols, placeholder thesis text, default side, default exchange, or empty broker-actionable drafts. |
| LLM ideas/GTT stage failure | Stage failures are not replaced with deterministic plans or synthetic GTT plans. | The research session is failed when output cannot be validated; uncertain GTT candidates are not persisted. |
| Conversation traces | Failed model/provider paths use failed conversation/error metadata rather than synthetic `deterministic-fallback` assistant output. | Auditors can distinguish real LLM responses from failed attempts; there is no fallback provider pretending to be a research agent. |
| GTT list broker status | Local GTT candidates and app-placed orders may still be shown, but broker GTT state has an explicit availability status. Missing credentials or broker fetch errors are represented as unavailable, not as `brokerGtts: []`. | The UI can display local records while stating `missing_credentials` or `fetch_failed`; an empty broker list only means the broker was queried successfully and returned none. |
| GTT placement last price | Kite GTT placement requires a fresh valid last price from market data/snapshots. The bracket target/stoploss/capital reference price is not used as a substitute last price. | Approval is blocked before any Kite mutation with a clear fresh-price-required error. |
| GTT approval context | When a candidate is surfaced or an approval window is shown, the intended direction is to attach/display a fresh snapshot of current price, volume, and bearish/bullish signals. | Users review live context before approving broker-side GTT placement. |
| Dry-run paper tracking | Dry-run mirrors regular run tracking, except orders are not placed in the live market. Paper trades require real market prices for entry/current value so EOD results reflect hypothetical live PnL. | No new zero-price `dry_run_tracking_no_price` rows should be created. Candidates without usable prices should be reported separately as not tracked/waiting for market data. |
| Dry-run EOD result | End-of-day dry-run summaries report the profit or loss that would have occurred for tracked paper trades. | PnL is based on real tracked prices, with untracked candidates called out separately. |
| Broker sync credentials | Portfolio/order/market sync APIs keep explicit credential failures such as `{ ok: false, reason: 'missing_kite_credentials' }`. | Broker calls are not attempted without valid credentials, and the UI can prompt reconnection instead of showing a generic empty sync. |

## Intentional safety gates retained

| Gate | Behavior | Why it remains |
| --- | --- | --- |
| Global dry-run mode | Live broker placement/cancel paths throw while dry-run mode is enabled. | Operator intent is to simulate only; no live mutation should occur. |
| Kill switch | Broker mutation paths throw while the kill switch is enabled. | This is the highest-priority fail-closed control. |
| Regular broker orders disabled | Regular market/limit order placement, modification, and cancellation remain blocked by `regularOrderExecutionDisabled()`. | Wolf only permits the constrained two-leg Kite GTT path with target and stoploss; accidental regular-order paths must hard-fail. |
| Kite API URL default | The broker adapter may default to `https://api.kite.trade` when no override is configured. | This is a standard endpoint default, not a trading/data fallback. Settings can still override it for testing/proxying. |

## Removed fallback behaviors

The following behaviors are not current/desired behavior:

- No deterministic morning research plan when the LLM key is missing.
- No `deterministic-fallback` provider/model recorded as if a research agent produced the plan.
- No field-by-field LLM normalization that invents market thesis, sector bias, watchlist symbols, sides, exchanges, quantities, rationale, or GTT drafts.
- No broker GTT `[]` response when broker state is unknown.
- No GTT placement using target/stoploss/capital reference as a last-price substitute.
- No dry-run simulated order with entry price `0` as a substitute for unavailable market data.

## Maintenance notes

- New behavior that handles missing data must document whether it is a **setup error**, **runtime failure**, **explicit unavailable state**, or **hard safety gate**.
- A broker-actionable path must not use fallback data to satisfy required broker API inputs.
- User-facing errors should name the missing provider, credential, market data, or validation field clearly enough for the user to fix it.
- If retries are added around provider/model calls, the retry budget and final failure behavior should be explicit and auditable.
