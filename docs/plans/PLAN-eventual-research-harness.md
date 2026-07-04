I reviewed the research-phase docs + implementation around:

- `docs/implementation/pre-market-catalyst-research.md`
- `docs/implementation/two-stage-research-with-transient-trade-candidates.md`
- `docs/fallbacks.md`
- `docs/architecture.md`
- `docs/implementation-plan.md`
- `backend/src/services/research.ts`
- `backend/src/prompts/morning-research.ts`
- `backend/src/providers/research/*`
- `backend/src/services/risk.ts`
- `frontend/src/pages/ResearchPage.tsx`

Targeted research tests pass: `17 pass / 0 fail`.

## Overall verdict

The research philosophy is directionally good: **pre-market catalyst-first, no hardcoded symbol fallbacks, two-stage LLM flow, explicit failure instead of synthetic fallback output, GTT drafts only after price context.** That is much better than “ask an LLM for stocks to buy.”

But the current harness still has several trust gaps. The biggest issue is that it says “grounded research,” but some grounding is still **prompt-enforced rather than code-enforced**.

## Highest-priority gaps / flaws

### 1. Symbol grounding is too weak

The docs say the small model extracts explicit NSE symbols only, but implementation accepts any classifier-returned regex-valid ticker:

- `backend/src/services/research.ts:323-356`
- `backend/src/services/research.ts:490-499`
- `backend/src/services/research.ts:614-615`

Risk: the small model can infer/hallucinate a ticker from a company name, and that ticker then becomes “allowed” downstream. This is circular grounding.

Improve by adding a real NSE/Kite instrument master table:

- symbol
- company name
- aliases
- ISIN
- exchange token
- instrument type
- active/suspended status

Then require every candidate to resolve through that table. Also verify the symbol/company alias appears in the source text or source metadata.

### 2. “Confidence” is collected but not really calibrated

The classifier returns confidence, but ranking mostly uses evidence count/provider count:

- `backend/src/services/research.ts:544`
- `backend/src/services/research.ts:550`

This treats multiple low-quality or duplicated articles as confidence. Better output a decomposed score:

```txt
freshness
source_quality
source_independence
symbol_resolution_confidence
catalyst_strength
price/liquidity_validation
contradiction_penalty
```

Then persist each component and show it in the UI.

### 3. GTT target/stop prices are still LLM-generated

The prompt says prices must be grounded:

- `backend/src/prompts/morning-research.ts:164`

But server validation mostly checks positive numbers, target/stop ordering, and whether the discovered candidate had some price context:

- `backend/src/services/research.ts:933-960`

It does **not** verify that target/stop levels came from a source, ATR, support/resistance, volatility, or risk model.

Better philosophy: let the LLM produce thesis/direction only. Let deterministic code generate or validate brackets using:

- current/reference price
- ATR or recent volatility
- support/resistance
- max loss
- capital per trade
- reward:risk minimum
- tick size

For trading safety, LLMs should not invent execution levels.

### 4. Risk limits are not deterministically enforced yet

The prompt includes trading-risk guardrails, but `risk.ts` explicitly marks several checks as informational:

- `backend/src/services/risk.ts:58`
- `backend/src/services/risk.ts:61`
- `backend/src/services/risk.ts:65`
- `backend/src/services/risk.ts:68`

So the system says “strict risk settings” but relies partly on LLM compliance/manual review. This is a major harness gap.

Move these into deterministic blockers before persistence or approval:

- max daily loss
- max trades/day
- max capital/trade
- max open positions
- planned stop-loss loss
- aggregate open GTT risk

### 5. Research does not actively fetch fresh quotes for shortlisted candidates

The flow enriches candidates from existing `marketSnapshots`:

- `backend/src/services/research.ts:267-270`

If snapshots are stale/missing, good candidates become watchlist-only or fail GTT readiness. For accuracy, after discovery/ranking, fetch fresh Kite quotes for the top K candidates and persist snapshot age/source. If Kite is unavailable, show “quote validation unavailable” explicitly.

### 6. Source provider strategy is too narrow

Current providers:

- Exa
- Finnhub
- optional NSE mover confirmation

Missing high-signal sources for Indian equities:

- NSE corporate announcements
- BSE corporate announcements
- exchange filings
- earnings calendar/results
- bulk/block deals
- F&O ban/rollover where relevant later
- pre-open data
- sector/index futures/global cues
- official company investor-relations RSS/pages

For Indian pre-market catalysts, exchange filings should outrank generic web/news search.

### 7. Prompt/source budget can grow unexpectedly

`promptSourcesLimit` is computed as:

```ts
Math.max(promptSourceLimit, discoveredCandidates.length)
```

at `backend/src/services/research.ts:730`.

That means `promptSourceLimit` is not really a max. Not catastrophic now, but it can hurt cost/latency. Better create a deterministic “source packet” per candidate and cap by token budget, not source count.

### 8. Watchlist cannot be empty

`normalizeIdeasPlan` rejects empty watchlists:

- `backend/src/services/research.ts:927-928`

This conflicts with the philosophy “prefer no trade over weak trade.” A weak-evidence day should be allowed to produce:

```json
{
  "watchlist": [],
  "tradeCandidates": [],
  "gttCandidates": [],
  "riskWarnings": ["No sufficiently grounded catalyst candidates."]
}
```

## Output improvements

The UI is good, but research outputs need more audit structure.

Add these to the research output:

1. **Candidate evidence map**
   - candidate ID
   - source IDs
   - source quality
   - exact evidence snippets
   - timestamp/freshness
   - contradiction status

2. **Why not advanced?**
   For every candidate:
   - `watchlist_only_reason`
   - `gtt_rejected_reason`
   - missing price?
   - missing liquidity?
   - risk breach?
   - weak evidence?

3. **Source freshness and quality in UI**
   `ResearchPage.tsx` shows source title/summary/url, but not `publishedAt`, source IDs, or confidence. Add timestamp, provider, source type, and stale badge.

4. **Provider warnings after reload**
   `hydrateSession` returns `providerWarnings: []` at `backend/src/services/research.ts:244-250`. Persist and hydrate provider warnings separately instead of only mixing them into `riskWarnings`.

5. **Prompt/model/cost/latency trace**
   Planned in docs but not implemented:
   - `docs/implementation-plan.md:262-265`
   - `docs/implementation-plan.md:525`

## Harness improvements

### Accuracy

- Add instrument-master symbol validation.
- Add source-claim verification pass.
- Require model outputs to reference `candidateId` and `sourceId`, not freeform prose.
- Add a verifier model or deterministic validator that checks every thesis against sources.
- Add exchange filings as first-class providers.
- Add outcome evals: precision@K, next-day move, GTT hit rate, drawdown, false-positive rate.

### Performance

- Add `AbortController` timeouts around provider and LLM calls.
- Add retry with backoff for transient provider failures.
- Add concurrency limits; current broad + focused fanout can become expensive.
- Cache provider search results by `{query, date, lookback}`.
- Dedupe sources before classification.
- Skip Stage 2 entirely when Stage 1 has no price-validated trade candidates.

### Cost

- Use strict source packets instead of dumping broad JSON context.
- Use small model for extraction/classification, medium for thesis, deterministic bracket engine instead of second LLM where possible.
- Persist usage from `OpenAiCompatibleProvider` into `model_usage_logs`; currently usage is only in raw response metadata.
- Add per-run budget guardrails: max provider calls, max tokens, max LLM repair attempts, max total cost.

## Better research architecture

I’d evolve toward this:

```txt
1. Collect official + news sources
2. Resolve entities through NSE/Kite instrument master
3. Extract candidate catalyst claims
4. Score candidates deterministically
5. Fetch fresh quote/liquidity/volatility context
6. LLM writes thesis only, citing candidate/source IDs
7. Verifier checks thesis against evidence packet
8. Deterministic bracket/risk engine proposes or rejects GTT levels
9. Persist full audit trail + cost/latency/eval metadata
10. EOD outcome evaluation feeds source/model scoring
```

The key shift: **LLM as analyst/writer, deterministic code as evidence gate, risk gate, and execution-level generator.**

## Recommended next steps

1. Add instrument-master-backed symbol resolution.
2. Make GTT price/risk validation deterministic.
3. Add source IDs / candidate IDs to prompts and require citations by ID.
4. Implement provider/LLM timeout, retry, rate-limit, and cache layer.
5. Add `model_usage_logs` + per-run cost/latency summary.
6. Add an evaluation harness with saved source bundles and historical outcome metrics.
7. Expand providers to NSE/BSE official announcements before adding more generic search providers.