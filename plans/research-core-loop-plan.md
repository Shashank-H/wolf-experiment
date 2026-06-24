# Core Research Loop Plan

## Context
- Goal: redesign/document the **research** flow from scratch, using the current code only as reference.
- Scope: only market/day-trading research. Do **not** include portfolio holdings, positions, RCA learnings, order execution, dry-run execution, or GTT placement as required research inputs.
- The current code calls this `morning research`, but the target should be named more generally: **research**, **market research**, or **pre-market research** depending on UI copy.
- The current API is synchronous. Target design should be asynchronous so long-running agent loops can stream progress to the frontend.

## Approach
- Treat the current implementation as a baseline, but plan the desired research loop explicitly.
- Add a purpose line for every step.
- Include tiny substeps, failure behavior, bad-data handling, and recovery recommendations.
- Use **Exa structured output** as the primary grounded web research/source extraction mechanism instead of building our own broad-source scraping/classification loop.
- Keep an **app-managed LLM** as the important decision-making agent. The LLM should decide when evidence is sufficient, when to ask Exa for follow-up details, which candidates to keep/drop, how to rank candidates, and how to synthesize the final watchlist.
- Keep provider fallback extensible: Exa is the required research/source provider for the first version; the app-managed LLM provider is also required for the core agent loop; multi-provider support can be a TODO.
- Minimize deterministic decision points in application code. Code should enforce setup, schema validation, loop/cost limits, symbol safety checks, persistence, and auditability; the LLM should handle judgment-heavy research decisions.

## Important current-code findings
- New user registration creates default rows:
  - `userSettings` is inserted in `backend/src/routes/auth.ts`.
  - `tradingPreferences` is inserted with `DEFAULT_TRADING_RISK_LIMITS` in `backend/src/routes/auth.ts`.
  - DB defaults also exist in `backend/src/db/schema.ts`.
- So bad numeric config values should not normally happen through the app UI. The existing parser still defensively clamps values because `providerConfig` is JSON and can contain unexpected values.
- Current broad discovery is effectively Exa-only, but current code treats Exa mostly as a raw source provider.
- Old implementation detail: `broadSourceLimit = 10` and 6 hardcoded broad queries meant `ceil(10 / 6) = 2` results requested per query. This only explains the old cap; it is **not** the target behavior.
- Target behavior should not clamp discovery to 2 results per query. Use Exa structured research/search to collect enough evidence, then cap stored sources/candidates after validation, dedupe, and ranking.
- Current classification sends collected raw sources to our LLM. Target flow should keep the app-managed LLM, but feed it Exa’s structured/grounded output rather than raw, noisy source lists.
- Current catalyst strength is a heuristic model score from `0` to `35`; target output should use a clearer `impactScore` scale such as `0-100`, with source-grounded reasons from Exa and final judgment from the app-managed LLM.
- Current fallback classification silently creates low-confidence candidates. Target flow should avoid silent fallback; if Exa or the LLM cannot return valid structured output, record warnings/diagnostics and fail or complete as no-actionable research depending on the final status decision.

## Target research workflow, step by step

### 1. Start research asynchronously
**Purpose:** return control to the frontend immediately while the research agent runs in the background.

1. Frontend calls `POST /research/runs` or similar.
2. Backend authenticates the user session.
3. Backend validates that required setup is complete before creating a run:
   1. Exa API key / Exa research provider is configured.
   2. App-managed LLM provider/API key is configured.
   3. Required default settings rows exist for the user.
4. If setup is invalid, backend returns a setup error immediately and does **not** create a run row or start research.
5. Backend creates a `research_run` row with:
   1. Unique run ID / token.
   2. User ID.
   3. Created timestamp in UTC.
   4. Optional client-provided local date/time zone metadata for display/filtering only.
   5. Status `queued`.
   6. Research type, e.g. `pre_market`, `market`, or `manual`.
6. Backend enqueues the actual research job.
7. Backend returns immediately with `{ runId, streamUrl }`.
8. Frontend uses `runId` to connect to an SSE endpoint, e.g. `GET /research/runs/:runId/events`.
9. SSE streams progress events, warnings, partial results, failures, and final completion.
10. If SSE is not available, frontend can fall back to HTTP long polling with `GET /research/runs/:runId`.

Failure / bad data behavior:
- If auth fails, return `401` and do not create a run.
- If Exa/provider config is missing, fail before the run row is created and before research starts.
- If app-managed LLM config is missing, fail before the run row is created and before research starts, because the LLM is the core decision-making agent.
- If enqueue fails, mark run `failed_to_start` and return a clear error.
- Recovery recommendation: add a setup checklist in UI before enabling the “Run research” button.

### 2. Display research history by localized date and run time
**Purpose:** allow multiple research runs on the same user-local date while keeping UI readable.

1. Store each run as its own row with unique ID.
2. Store timestamps in UTC in the database.
3. Do not enforce only one completed row per date.
4. Group runs client-side by the user’s localized date derived from UTC timestamps.
5. Inside each localized date group, show individual entries sorted by created time.
6. Show a localized date separator line, then all runs for that date.
7. Each entry should show:
   1. Localized time.
   2. Status.
   3. Research type.
   4. Summary.
   5. Warning/failure count.
   6. Link to full trace.

Failure / bad data behavior:
- Existing schema currently has a uniqueness constraint on user + trade date + dry-run mode. Remove date-based uniqueness for the new research history model.
- Recovery recommendation: use a run-based table keyed by run ID, store UTC timestamps, optionally store client time zone/local date metadata for display convenience, and allow multiple completed/failed/running entries for the same localized date.

### 3. Emit a “run started” event
**Purpose:** confirm to the UI that the async stream is alive.

1. Worker picks up the queued run.
2. Status changes from `queued` to `running`.
3. Backend emits SSE event `research.started`.
4. Event includes run ID, UTC created time, optional client time zone/local date metadata, and configured provider names.

Failure / bad data behavior:
- If worker cannot load run, emit/store `research.failed` if possible.
- Recovery recommendation: add a timeout detector for runs stuck in `queued`.

### 4. Load research-only settings
**Purpose:** use only settings that affect day-trading research.

1. Load research settings such as:
   1. Max source count.
   2. Max watchlist count.
   3. Candidate shortlist size.
   4. Freshness/lookback window.
   5. Risk tolerance if still needed for idea selection.
2. Do **not** load holdings or positions for this research phase.
3. Do **not** load RCA learnings for now; hold this requirement.
4. Do **not** depend on market snapshots unless we decide research must generate price-based trade levels.

Failure / bad data behavior:
- Defaults should exist because registration creates default rows.
- If rows are missing due to legacy/corrupt data, create defaults or fail with “account setup incomplete.”
- Recovery recommendation: add an account setup repair/migration path rather than allowing hidden fallback behavior.

### 5. Validate Exa and LLM provider availability
**Purpose:** fail before creating a research run if either required AI provider is missing.

1. Read configured research/source providers.
2. Require Exa provider config for the first version.
3. Read configured app-managed LLM provider.
4. Require the LLM API key/config because the LLM makes the research decisions and final synthesis.
5. Optional: run lightweight provider-key tests in settings or during setup, but avoid expensive research calls just to start a run.
6. TODO: support additional source/LLM providers later with provider priority and fallback.
7. Emit `research.providers.validated` only after a run has been created and the worker confirms the provider configs used.

Failure / bad data behavior:
- If Exa or LLM config is missing, return a setup error from `POST /research/runs` and do **not** create a run.
- If a key is present but invalid/rate-limited/concurrency-limited, the provider call can fail after run creation; mark the run failed with the exact provider error code/message where safe.
- Recovery recommendation: add lightweight “test Exa key” and “test LLM key” actions in settings and disable “Run research” until required setup passes.

### 6. Submit Exa structured research run
**Purpose:** let Exa gather fresh, grounded market evidence and return structured source/candidate material for the app-managed LLM agent to reason over.

1. Backend worker creates an Exa Agent run with `POST /agent/runs`.
2. Use `query` for the full natural-language research instruction, e.g. find current Indian/NSE cash-equity day-trading catalysts for the client-local research date/window, with UTC boundaries passed explicitly when needed.
3. Use `outputSchema` so Exa returns validated structured JSON in `output.structured`.
4. Use `systemPrompt` to enforce source quality and behavior:
   1. Prefer fresh Indian market/news/company/exchange sources.
   2. Avoid duplicate sources and duplicate companies.
   3. Do not invent symbols, catalysts, or facts.
   4. Every candidate must cite evidence URLs/source IDs.
   5. Return unresolved company names separately instead of guessing tickers.
5. Use `effort` as a config setting:
   1. Default: `low` for the first implementation to control cost and latency.
   2. Allow `medium`/`high` later only when the user explicitly wants deeper research.
   3. Avoid `auto` initially if predictable cost is preferred.
6. Use `metadata` to store app context on the Exa run, e.g. app run ID, user ID, UTC created time, client time zone/local date if provided, research type, and environment.
7. Use `input.exclusion` where useful to avoid known bad domains, blacklisted symbols, or previous duplicate results on reruns.
8. Use `input.data` only for small structured inputs that help Exa, such as unresolved company rows in a follow-up run. Do not send large instrument masters or portfolio data.
9. Store the returned Exa `agent_run` ID on our `research_run` row.
10. Stream Exa lifecycle events with `Accept: text/event-stream` or replay them with `GET /agent/runs/:id/events`, then map them into our own SSE events.
11. Persist Exa `usage` and `costDollars` for audit and cost visibility.
12. Do not rely on Exa `budget.maxCostDollars`; the docs mark it deprecated/ignored.
13. Emit `research.exa.started`.

Failure / bad data behavior:
- If Exa returns `AUTHENTICATION_ERROR`, `CONCURRENCY_LIMIT_REACHED`, `INVALID_OUTPUT_SCHEMA`, `TIMEOUT`, or server error, mark the run failed with a user-readable setup/retry message.
- If Exa completes without `output.structured`, fail schema validation instead of attempting silent fallback.
- Recovery recommendation: keep the Exa run ID so support/debug tools can inspect Exa events, cost, and grounding.

### 7. Exa structured output contract
**Purpose:** replace our broad-query fanout with one source-grounded schema that the app-managed LLM can use as its working context.

1. Define a strict JSON schema for Exa output. Required top-level fields should include:
   1. `researchWindowUtc` and optional `clientLocalDate` / `clientTimeZone` metadata.
   2. `market`, default `NSE_EQ`.
   3. `marketThesis`.
   4. `themes`.
   5. `sources`.
   6. `candidates`.
   7. `unresolvedCompanies`.
   8. `warnings`.
2. Each source should include `id`, `title`, `url`, optional `publisher`, optional `publishedAt`, and a concise summary/highlight.
3. Each candidate should include:
   1. `companyName`.
   2. `symbol` if Exa can support it with evidence.
   3. `exchange`, expected `NSE` for now.
   4. `catalystType`.
   5. `direction`: `bullish`, `bearish`, `neutral`, or `unknown`.
   6. `impactScore` on a documented `0-100` scale.
   7. `confidence` on a documented `0-1` scale.
   8. `whyToday`.
   9. `evidenceSourceIds` and/or source URLs.
   10. `warnings`.
4. `unresolvedCompanies` should preserve useful no-ticker discoveries with source IDs and a reason.
5. Bound arrays with `maxItems` so cost/output size stays predictable, e.g. `maxCandidatesFromExa`, `maxSourcesToStore`, and `candidateShortlistSize`.
6. Preserve Exa `output.grounding` field-level citations when available.
7. Treat Exa scores/candidate fields as evidence, not final app decisions; the app-managed LLM will decide follow-up, keep/drop, ranking, and final narrative.
8. Emit `research.exa.completed` once Exa reaches a terminal successful state.

Failure / bad data behavior:
- If required fields are missing, fail schema validation.
- If candidates are not source-grounded, drop them with reason `missing_evidence`.
- If Exa returns more sources/candidates than configured, store diagnostics first, then cap display/output.
- Recovery recommendation: version the output schema so future Exa prompt/schema changes do not break old persisted runs.

### 8. Optional Exa Search/Contents fallback parameters
**Purpose:** keep a lower-level Exa path available if Agent output needs targeted refresh or verification.

1. Prefer Exa Agent for the first evidence-gathering step because it is asynchronous, returns structured output, and includes grounding.
2. Use `POST /search` or `/contents` as tools that the app-managed LLM can request during its bounded research loop.
3. Useful `/search` parameters to expose to the LLM tool layer/config:
   1. `type`: use `deep` or `deep-reasoning` for grounded structured synthesis; use `auto`/`fast` only for lighter source lookup.
   2. `outputSchema`: request structured `output.content` for targeted extraction.
   3. `stream`: enable SSE for synthesized output when using `outputSchema`.
   4. `numResults`: set a generous but bounded cap such as 30-50, never hard-code 2 per query unless cost data proves it is needed.
   5. `additionalQueries`: provide up to 10 curated query variations instead of manual fanout loops.
   6. `startPublishedDate` / `endPublishedDate`: enforce the configured freshness window.
   7. `includeDomains` / `excludeDomains`: prefer or suppress specific publishers/domains when product settings define them.
   8. `userLocation`: set `IN` for India-oriented search where useful.
   9. `moderation`: enable for safer results.
   10. `systemPrompt`: reinforce source quality, dedupe, and no-guessing rules.
   11. `contents.highlights`: prefer highlights for compact evidence.
   12. `contents.summary.query` or `contents.summary.schema`: ask for catalyst-focused summaries when needed.
   13. `contents.text.maxCharacters`: only fetch bounded full text when highlights/summary are insufficient.
   14. `contents.maxAgeHours`: use `0` only when fresh live crawl is required; otherwise use a small cache window to reduce latency/cost.
4. Avoid deprecated search/content parameters where possible, especially `context` and `livecrawl`.
5. Use `/contents` with `urls` or Exa result `ids` only when cited pages need re-fetching; prefer highlights/summaries over full text.
6. Emit `research.llm_action.requested`, `research.followup.started`, and `research.followup.completed` when the LLM asks for targeted Exa follow-up.

Failure / bad data behavior:
- If targeted search fails for one candidate, keep the Exa Agent candidate but add `needs_manual_validation` or lower confidence.
- If targeted search contradicts the candidate, mark `conflicting_evidence` and reduce rank or move to watchlist-only.
- Recovery recommendation: keep raw Exa request parameters and response IDs in diagnostics for replayability.

### 9. Validate, clean, and dedupe Exa output
**Purpose:** protect downstream UI/database from malformed, stale, duplicate, or unsupported output.

1. Validate Exa `output.structured` against our app schema.
2. Validate every source has a usable URL/title/summary or grounding citation.
3. Dedupe exact URLs and duplicate source titles.
4. Apply freshness/lookback checks using source `publishedAt` when available; if missing, retain only when Exa grounding is strong and add a warning.
5. Validate every candidate references at least one retained source.
6. Normalize catalyst fields and clamp `impactScore` / `confidence` to documented ranges.
7. Keep dropped-source and dropped-candidate records with reasons.
8. Emit `research.structured_output.validated`.

Failure / bad data behavior:
- If no usable source remains, fail early with `no_research_sources_found`.
- If structured JSON is invalid, retry once only by creating a follow-up Exa Agent run with `previousRunId` and a schema-repair instruction, or mark failed if retry is disabled.
- Do not let the LLM consume unvalidated Exa output as trusted facts; pass invalid output only as diagnostics for repair.
- Recovery recommendation: store the original structured output snapshot even when validation fails, so the user can inspect what went wrong.

### 10. Resolve unresolved symbols only when needed
**Purpose:** retain useful no-ticker discoveries while avoiding guessed tradable symbols.

1. Take Exa `unresolvedCompanies` and candidates without validated symbols.
2. Attempt symbol resolution using reliable sources, in priority order:
   1. Broker instrument master, if available.
   2. Exchange/instrument reference data, if available.
   3. Exa follow-up run/search with `input.data` containing only unresolved company rows and instructions to cite evidence.
3. If multiple symbols match one company name, keep it unresolved; do not guess.
4. If resolved, attach resolution method, confidence, and source evidence.
5. If not resolved, retain the item in diagnostics and drop it from tradable candidates.
6. Emit `research.symbols.resolved`.

Failure / bad data behavior:
- Do not use a hand-written company-name mapper as the primary strategy.
- Do not silently discard missing-ticker news before symbol resolution.
- Recovery recommendation: add broker/exchange instrument master sync if not already available.

### 11. Apply market/universe filters
**Purpose:** restrict research to the currently supported trading universe.

1. Apply configured exchange/universe filter.
2. Current app is NSE cash-equity focused, so default to `NSE_EQ`.
3. Make exchange/universe configurable later.
4. Check symbol format once in a shared normalization/validation helper.
5. Apply blacklist filters.
6. Apply freshness filters.
7. Record every dropped candidate with reason.
8. Emit `research.candidates.filtered`.

Failure / bad data behavior:
- If all candidates are filtered out, do not continue blindly.
- Ask the app-managed LLM agent to inspect dropped reasons and choose one bounded recovery action: targeted Exa follow-up, symbol-resolution request, reinterpretation of evidence, or `no_actionable_candidates`.
- If still empty, complete as `completed_no_actionable_candidates` or fail based on the final product decision.
- Recovery recommendation: keep recovery bounded by attempt count, provider calls, tokens, effort, and cost visibility.

### 12. Let the app-managed LLM decide candidate actionability and ranking
**Purpose:** minimize hard-coded decision points by letting the LLM reason over evidence, conflicts, freshness, and trade relevance.

1. Send validated Exa output, grounding, diagnostics, symbol-resolution results, research settings, and allowed actions to the LLM.
2. Ask the LLM for strict JSON output containing:
   1. Candidates to keep.
   2. Candidates to drop, with reasons.
   3. Candidates needing follow-up, with a specific requested action.
   4. Ranked watchlist order.
   5. Ranking rationale tied to source IDs.
   6. Missing-data and risk warnings.
3. The LLM may use non-deterministic judgment for catalyst importance, source sufficiency, conflict severity, and whether more detail is required.
4. Application code should not secretly override the LLM’s ranking except for safety/schema/universe violations.
5. Code should enforce only guardrails:
   1. Valid JSON/schema.
   2. Candidate references retained sources.
   3. Symbol is in supported universe before it becomes actionable.
   4. Candidate count does not exceed configured limits.
   5. No holdings, orders, GTT placement, or execution instructions enter this core research phase.
6. Emit `research.llm.review.completed` and `research.candidates.ranked`.

Failure / bad data behavior:
- If LLM output is invalid, retry once with a repair prompt.
- If the LLM requests an unsafe/out-of-scope action, reject that action, add a warning, and ask for a valid bounded action once.
- If the LLM ranks zero candidates, let it explicitly choose `completed_no_actionable_candidates` or one bounded follow-up action.
- Recovery recommendation: store LLM prompt, response, selected actions, and rejected actions for auditability.

### 13. Bounded LLM action loop for targeted follow-up
**Purpose:** allow the LLM to take useful research actions, such as looking for more detail about a stock or news item, without hard-coding every decision path.

1. Define a small tool/action schema the LLM can choose from:
   1. `request_exa_search` for a focused query.
   2. `request_exa_contents` for cited URLs needing more detail.
   3. `request_symbol_resolution` for unresolved company names.
   4. `accept_candidate`.
   5. `drop_candidate`.
   6. `finalize_research`.
   7. `mark_no_actionable_candidates`.
2. Let the LLM decide whether a candidate needs more evidence, contradiction checks, symbol confirmation, or can be accepted/dropped.
3. Execute only allowed actions through backend tools; the LLM never calls providers directly.
4. Feed tool results back to the LLM for the next decision.
5. Stop when the LLM returns `finalize_research` / `mark_no_actionable_candidates`, or when max iterations/cost/time is reached.
6. Recommended initial bounds:
   1. Max LLM decision turns: 3.
   2. Max Exa follow-up calls: 3 total.
   3. Max follow-up per candidate: 1 unless explicitly increased later.
7. Emit `research.llm_action.requested`, `research.llm_action.completed`, and follow-up provider events.

Failure / bad data behavior:
- Failed follow-up should not fail the whole run if initial evidence is sufficient; return the failure to the LLM and let it decide accept/drop/warn.
- Contradictory evidence is returned to the LLM for judgment instead of using hard-coded rank reduction.
- If loop bounds are reached, ask the LLM for a best-effort final result with explicit missing-data warnings.
- Recovery recommendation: persist every LLM action request, tool input, tool output, and loop stop reason.

### 14. Optional reactive mover confirmation
**Purpose:** optionally check whether shortlisted candidates are also showing live mover behavior after market open.

1. This step is disabled for pure pre-market research.
2. If enabled, fetch top gainers/losers or live mover data.
3. Use it only as confirmation, not primary discovery.
4. Attach `reactiveSignal` if a shortlisted candidate matches.
5. Do not add unrelated top movers as new candidates unless the user explicitly runs an after-open research mode.
6. Emit `research.reactive_confirmation.completed`.

Failure / bad data behavior:
- If reactive provider fails, keep existing candidates and record a warning.
- If reactive data contradicts candidate direction, add warning instead of deleting silently.
- Recovery recommendation: separate `pre_market` and `after_open` research modes so this step is not confusing.

### 15. LLM final synthesis
**Purpose:** have the app-managed LLM produce the user-visible research result from grounded Exa evidence and follow-up tool results.

1. Send the final validated evidence packet to the LLM.
2. Ask for strict JSON output.
3. Final output should include:
   1. Market thesis.
   2. Sector/theme bias.
   3. Watchlist candidates in LLM-ranked order.
   4. Candidate-specific thesis.
   5. Evidence references.
   6. Risk warnings.
   7. Missing-data warnings.
   8. Dropped/unresolved diagnostics.
   9. Any follow-up actions taken and why.
4. Do not require GTT candidates unless we later add a separate post-research trade-planning step.
5. Validate final JSON and source references.
6. Emit `research.result.ready`.

Failure / bad data behavior:
- Invalid JSON gets one repair attempt.
- If final output has sources but no actionable candidates, prefer `completed_no_actionable_candidates` over generic `failed` if the product accepts that status.
- Unsupported symbols are dropped from actionable output by guardrail code but retained in diagnostics.
- Recovery recommendation: distinguish provider/LLM failures from valid no-actionable research days.

### 16. App-managed LLM dependency decision
**Purpose:** keep LLM API key management in the app and make the LLM central to research decisions.

1. Core research requires both:
   1. Exa provider config for grounded web evidence and structured source extraction.
   2. App-managed LLM provider config for decisioning, action selection, ranking, and final synthesis.
2. Exa should not remove the need for our LLM; it should reduce raw-source complexity and provide grounded structured inputs.
3. The LLM should be allowed to decide when more detailed information is needed for a stock/news item.
4. Backend code should expose safe tools and enforce guardrails, not encode every research decision.
5. The LLM provider should continue using existing app key management/settings.

Failure / bad data behavior:
- If the LLM key is missing, fail before creating the run and show setup guidance.
- If the LLM call fails mid-run, mark run failed unless enough prior LLM output exists to safely complete with warnings.
- Recovery recommendation: settings UI should label both “Required source provider: Exa” and “Required decision model: LLM provider.”

### 17. Store final context snapshot
**Purpose:** preserve enough evidence to debug and replay a run.

1. Include Exa request parameters.
2. Include Exa run ID, events, status, usage, and cost.
3. Include Exa structured output and grounding.
4. Include LLM prompts, responses, action decisions, tool calls, rejected actions, and stop reason.
5. Include validated sources.
6. Include LLM-ranked candidates.
7. Include dropped-source and dropped-candidate diagnostics.
8. Include provider warnings.
9. Include research settings.
10. Exclude portfolio holdings/positions for this phase.
11. Exclude RCA learnings for now.
12. Exclude market snapshots unless we explicitly need price-based trade levels.
13. Emit `research.context.ready`.

Failure / bad data behavior:
- If context has no sources, fail before final result persistence.
- Recovery recommendation: store the context snapshot so user can inspect why the run failed.

### 18. Persist result atomically
**Purpose:** make run history consistent and auditable.

1. Write final run status.
2. Write market thesis and watchlist/research items.
3. Write all sources used.
4. Write dropped-source diagnostics.
5. Write dropped-candidate diagnostics.
6. Write Exa request/response snapshot, run ID, events, grounding, usage, and cost.
7. Write LLM prompt/response/action trace and token/cost metadata where available.
8. Write provider warnings.
9. Write timing metrics.
10. Use a DB transaction for result persistence.
11. Do not delete or overwrite previous successful runs that display under the same localized date.
12. Emit `research.completed`, `research.completed_no_actionable_candidates`, or `research.failed`.

Failure / bad data behavior:
- If persistence fails, mark run persistence failure if possible.
- Recovery recommendation: keep previous successful results unchanged and never wipe them because a later rerun failed.

### 19. SSE / polling event model
**Purpose:** give frontend live visibility into long research sessions.

1. `POST /research/runs` returns `runId` and stream endpoint.
2. `GET /research/runs/:runId/events` streams events.
3. Event examples:
   1. `research.started`.
   2. `research.providers.validated`.
   3. `research.exa.started`.
   4. `research.exa.event` for mapped Exa Agent lifecycle/progress events.
   5. `research.exa.completed`.
   6. `research.structured_output.validated`.
   7. `research.llm.review.started`.
   8. `research.llm_action.requested`.
   9. `research.llm_action.completed`.
   10. `research.symbols.resolved`.
   11. `research.candidates.filtered`.
   12. `research.candidates.ranked`.
   13. `research.followup.started` / `research.followup.completed` if the LLM requests targeted follow-up.
   14. `research.result.ready`.
   15. `research.completed`.
   16. `research.completed_no_actionable_candidates`.
   17. `research.failed`.
4. `GET /research/runs/:runId` returns current state for polling/reconnect.
5. `GET /research/runs` returns UTC run timestamps; the frontend groups by localized date. If server-side filtering is needed later, pass both `date=YYYY-MM-DD` and `timeZone=Area/City`, convert to a UTC range server-side, and still store UTC.

Failure / bad data behavior:
- SSE clients can disconnect; server should allow reconnect by run ID.
- Recovery recommendation: persist events or enough run state to rebuild UI after reconnect.

## Explicit decisions from feedback
- Use asynchronous research runs with run ID/token and SSE/polling.
- Rename from “morning research” toward research/market research/pre-market research.
- Support multiple entries per localized client-side date, grouped by localized date and separated by localized run time; store timestamps in UTC.
- Remove holdings/positions from the core research phase.
- Hold RCA learnings for later.
- Exa provider config and app-managed LLM config must both be validated before a run row is created.
- Use Exa structured output as the primary grounded discovery/source-extraction layer.
- Use the app-managed LLM as the primary decision-making, follow-up-action, ranking, and final synthesis layer.
- Minimize deterministic application-code decisions; keep code focused on guardrails, schema validation, tool execution, audit logs, and safety constraints.
- Do not add a “sources-only diagnostic run” for now.
- Fail early when there are zero usable sources after Exa output validation.
- Do not silently discard no-ticker sources; attempt symbol resolution.
- Do not use a hand-maintained company-name mapper as the main solution.
- Explain why NSE exists: current app is NSE cash-equity focused; make it configurable later.
- Symbol validation should be centralized, not repeated ad hoc.
- Ranking is currently deterministic app code, but target ranking should be an LLM decision with source-grounded explanations and schema guardrails.
- If all candidates are filtered, ask the LLM for one bounded recovery action, then complete as no-actionable or fail based on product status semantics.
- Track dropped items, LLM decisions, and rejected actions for auditability.
- Market snapshots are not part of core research unless we later need price-based trade levels.
- Targeted follow-up exists when the LLM decides a stock/news item needs more detail, validation, or symbol resolution.
- Exa structured output should be reused as grounded evidence; the LLM should reason over it rather than our code manually classifying every source.
- Reactive mover confirmation is optional and should have a clear purpose.
- Lower-level Exa `/search` and `/contents` parameters are exposed as safe LLM-requestable tools for fallback/verification.

## Files likely to modify later
- `backend/src/routes/research.ts` — replace synchronous run endpoint with async run creation and status/SSE endpoints.
- `backend/src/services/research.ts` — refactor orchestration into async run handling around Exa structured evidence, LLM action loop, validation, ranking/synthesis, and persistence.
- `backend/src/db/schema.ts` — add/adjust run-based research tables, store timestamps in UTC, and remove one-run-per-date constraint for target history.
- `backend/src/providers/research/*` — revise Exa provider integration for Agent/Search/Contents structured output and LLM-requestable follow-up tools; keep room for future providers.
- `frontend/src/pages/ResearchPage.tsx` — show client-localized date-grouped runs, Exa-backed progress, warnings, costs, and final structured result.
- `frontend/src/lib/api.ts` — add run creation, SSE/polling, and history APIs.

## Reuse
- `backend/src/providers/research/types.ts` for source/candidate/action type ideas, with revisions for Exa structured output, grounding, LLM actions, usage, and diagnostics.
- `backend/src/providers/research/ExaProvider.ts` as the required first source/research provider, expanded from raw search into Agent/Search/Contents support.
- `backend/src/providers/research/OpenAiCompatibleProvider.ts` as the required first app-managed LLM provider for decisioning, action selection, ranking, and synthesis.
- `backend/src/services/research-discovery.test.ts` as reference for current helper behavior, not necessarily target behavior.

## Verification
- Unit test async run creation validates required Exa and LLM setup before creating/enqueueing a run.
- Unit test missing Exa provider config fails before run row creation.
- Unit test missing app-managed LLM key fails before run row creation.
- Unit test Exa Agent request includes `query`, `systemPrompt`, `outputSchema`, `effort`, `metadata`, and safe exclusions.
- Unit test Exa Search fallback config supports useful parameters (`type`, `numResults`, `additionalQueries`, freshness dates, domain filters, `userLocation`, `moderation`, content highlights/summary/text limits, and `maxAgeHours`).
- Unit test invalid/missing Exa structured output fails validation before being treated as facts by the LLM.
- Unit test zero usable sources fails early.
- Unit test LLM action schema accepts only allowed actions and rejects unsafe/out-of-scope actions.
- Unit test LLM can request targeted Exa follow-up for weak evidence, contradictions, or symbol ambiguity.
- Unit test LLM loop stops at max iterations/cost/tool-call bounds.
- Unit test no-ticker candidate enters symbol resolution before dropping.
- Unit test filtered-out candidates are sent to the LLM for one bounded recovery action.
- Unit test LLM-ranked output validates source references and universe constraints.
- Unit test dropped candidates/sources and LLM decision traces are persisted with reasons.
- Integration test SSE streams start, Exa events, LLM action events, validation, ranking, warning, and completion/failure events.
- UI test groups multiple same-client-local-date runs under one localized date heading while DB timestamps remain UTC.

## Resolved decisions from latest feedback
- Design the run type enum now for `pre_market`, `after_open`, and `manual`.
- Default Exa `effort` should be `low`.
- LLM model choice and token/cost settings are not a concern right now; use the existing app-managed LLM configuration path.
- Store dates/timestamps in UTC. Any user-facing grouping, display, and date input should be localized client-side. If the backend later filters by date, it must receive the client time zone and convert the requested local date to a UTC range.

## Remaining open question for review
1. For no actionable candidates after recovery, should the run status be `failed` or `completed_no_actionable_candidates`? Recommendation: use `completed_no_actionable_candidates` when Exa research succeeded but nothing tradable survived validation.
