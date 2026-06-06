# Progress

## Status
Phase 5A complete; Phase 5B live GTT/order execution core implemented

## Tasks
- Added Phase 3 research persistence, providers, morning research APIs/UI, and fallback planner.
- Added Phase 4 trigger/risk/approval persistence schema and Drizzle migrations.
- Implemented strict Trigger JSON DSL validation and deterministic evaluator helper.
- Implemented deterministic risk engine with persisted decisions and approval creation.
- Added trigger and approval APIs.
- Added kill switch setting.
- Added frontend Trigger Rules and Pending Approvals screens.
- Verified backend and frontend typechecks.
- Extracted morning research prompts into a dedicated prompt module.
- Added configurable morning research limits and risk tolerance.
- Added `/settings/research` API and server-side enforcement of research output caps.
- Split trading controls into `/trading-settings` and app/provider configuration into obscured `/settings`.
- Added home-page setup warnings with a CTA to app settings when API keys/auth are missing.
- Replaced crowded top nav with a fixed vertical sidebar and settings gear shortcut.
- Cleaned up research UI with summary cards and a right-side deep-dive drawer.
- Added global dry-run mode setting and scheduler configuration.
- Added dry-run flags/fields to the existing research and orders tables, plus RCA reports/findings schema and migration.
- Added global dry-run behavior: normal morning research honors the setting, marks generated GTT candidates as `dry_run_approved`, creates simulated tracked orders, and never places broker orders.
- Added dry-run EOD flow: marks simulated orders to latest market snapshots, computes hypothetical PnL, closes them, and stores RCA reports/findings.
- Fed recent RCA learnings into the morning research prompt context.
- Removed separate Research-page dry-run controls; dry-run is a global Trading Settings mode, not a per-page workflow.

- Added Phase 5B live execution core with `gtt_orders`, order idempotency keys, broker response/event logging, and migration `0006_elite_lifeguard.sql`.
- Added `/gtt` APIs for candidates, active app GTTs, broker GTT status, approve/reject/cancel.
- GTT approval now places live Kite GTTs when dry-run mode and kill switch are off; dry-run globally blocks broker placement.
- Manual approval of `place_order` requests now submits live Kite orders through the execution engine with idempotency and order events.
- Wired market polling to evaluate active trigger rules; matched triggers now create approvals or YOLO-approved executions after deterministic risk checks.
- Added frontend GTT Orders screen and sidebar route with candidate approval/rejection, active GTT cancellation, and broker status.

## Files Changed
- backend/src/db/schema.ts
- backend/drizzle/0003_foamy_owl.sql
- backend/drizzle/0004_jazzy_sauron.sql
- backend/drizzle/0005_dry_run_mode.sql
- backend/drizzle/meta/0003_snapshot.json
- backend/drizzle/meta/0004_snapshot.json
- backend/drizzle/meta/_journal.json
- backend/src/providers/research/*
- backend/src/services/research.ts
- backend/src/services/dry-run.ts
- backend/src/services/dry-run-scheduler.ts
- backend/src/services/risk.ts
- backend/src/services/triggers.ts
- backend/src/routes/research.ts
- backend/src/routes/triggers.ts
- backend/src/routes/settings.ts
- backend/src/index.ts
- frontend/src/pages/ResearchPage.tsx
- frontend/src/pages/TriggersPage.tsx
- frontend/src/pages/ApprovalsPage.tsx
- frontend/src/pages/OverviewPage.tsx
- frontend/src/pages/TradingSettingsPage.tsx
- frontend/src/router.tsx
- frontend/src/components/AppShell.tsx
- frontend/src/components/ui.tsx
- frontend/src/pages/SettingsPage.tsx
- frontend/src/types.ts
- frontend/src/styles.css
- docs/implementation/phase-3-summary.md
- docs/implementation/phase-4-summary.md
- docs/implementation/ui-settings-research-update.md
- docs/implementation/phase-5a-dry-run-summary.md

## Validation
- `bun run typecheck` passes.

## Notes
- Approvals only record manual decisions. No broker execution was added in Phase 4.
- Trigger evaluation is implemented as a deterministic helper but is not yet wired to the market polling loop.
- App/provider settings are no longer in primary navigation; users reach them via the sidebar gear or setup CTA.
- Research detail is intentionally moved out of the main page into the slide-in drawer.
- Dry-run PnL depends on available `market_snapshots`; if no quote exists for a symbol it remains tracked at entry/zero until market polling supplies prices.
- `DRY_RUN_SCHEDULER_ENABLED=true` enables automated morning/EOD tracking and RCA jobs for users with global dry-run mode enabled.
- Live broker GTT/order placement is intentionally deferred to Phase 5B.

- Added product decision to docs: `/today` is the primary execution cockpit with tabs for research, GTT, triggers, approvals, orders, and dry-run/RCA.
- Added `/history` archive and `/history/:date` read-only replay pattern to docs and MVP plan.
- Built backend daily bundle APIs: `GET /today`, `GET /history`, `GET /history/:date`.
- Built frontend Today cockpit and History replay pages using the same tabbed UI model.

- Navigation refinement: `/today` now owns the operational surfaces that used to be top-level tabs: research, GTT, triggers, approvals, and orders. The sidebar is simplified to durable app areas only.
- `/today` and `/history/:date` now start with a Summary tab, followed by underline-style tabs for Research, GTT, Triggers, Approvals, Orders, and Dry-run/RCA. The former top hero/metrics block lives inside Summary.

- Refined Today navigation again per product direction: everything operational now lives under `/today/*` sub-pages (`/today/research`, `/today/gtt`, `/today/triggers`, `/today/approvals`, `/today/orders`) instead of only local in-page tabs.
- Preserved the original functional pages/actions inside the new Today sub-pages, so running morning research, adding watchlist items, approving/rejecting/cancelling GTTs, trigger actions, approvals, and order views remain available.
- Removed the global session/email subheading from the page header and upgraded the header to a more modern application-style title treatment.
