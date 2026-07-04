# Phase 5A — Global Dry-Run Trading and EOD RCA Loop

## Implemented

- Added a global dry-run mode toggle on Trading Settings.
- Reworked dry-run persistence to use the same core tables with flags, not separate dry-run tables:
  - `daily_research_sessions.is_dry_run`
  - `orders.is_dry_run`
  - `gtt_candidates.status = dry_run_approved`
- Added MVP RCA tables:
  - `rca_reports`
  - `rca_findings`
- Added migration `backend/drizzle/0005_dry_run_mode.sql`.
- Added dry-run APIs for status/history/EOD RCA:
  - `GET /dry-run/today`
  - `GET /dry-run/history`
  - `POST /dry-run/complete-eod`
  - `PUT /settings/dry-run-mode`
- Added global dry-run behavior:
  - the normal morning research action honors the global dry-run setting
  - runs morning research as an `is_dry_run` research session when global dry-run is on
  - marks generated GTT candidates as `dry_run_approved`
  - creates simulated `orders` rows with `is_dry_run = true`
  - blocks broker placement while preserving the MVP research/tracking/RCA flow
- Added EOD dry-run RCA flow:
  - reads latest market snapshots
  - computes hypothetical PnL on simulated orders
  - closes simulated orders
  - stores RCA report and trade-level findings
- Added RCA-learning injection into morning research prompts so prior EOD RCA can influence future research.
- Added optional scheduler:
  - `DRY_RUN_SCHEDULER_ENABLED=false` by default
  - `DRY_RUN_MORNING_TIME_IST=08:45`
  - `DRY_RUN_EOD_TIME_IST=15:35`

## Operational Notes

- Dry-run PnL quality depends on market snapshots being available for the symbols being tracked.
- If a simulated GTT lacks usable prices and no market snapshot exists, it is still tracked but PnL remains zero until price data appears.
- If no GTT candidates are produced, dry-run falls back to trade candidates with quantity 1 so the research loop can still be evaluated.
- When global dry-run is enabled, no live order or GTT placement is performed anywhere; the system tracks simulated orders instead.

## Still Pending for Phase 5B

- Live Kite GTT placement.
- Idempotent broker execution engine.
- Approval-to-execution handoff.
- Broker response logging/state transitions.
- Safe retry semantics.
