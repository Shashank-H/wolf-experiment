# UI, Settings, and Research Prompt Update

## Summary

Implemented a UX and configuration pass across the frontend settings and research flows, plus backend support for configurable morning research prompts.

## Product Changes

### Navigation

- Replaced the crowded top navigation with a fixed vertical desktop sidebar.
- Sidebar remains fixed while page content scrolls.
- Mobile layout still falls back to a compact sticky top navigation.
- Added a settings gear icon near the theme switcher for direct access to app/provider settings.

### Settings IA

- Split settings into two distinct areas:
  - `/trading-settings` for trading automation, risk limits, and research generation preferences.
  - `/settings` for app/provider configuration such as Kite, market-data keys, and LLM settings.
- App/provider settings are intentionally obscured from primary navigation and reachable via:
  - the sidebar gear icon
  - home-page setup/action cards when configuration is incomplete
  - Zerodha callback flow

### Home Setup Guidance

The home page now surfaces setup issues instead of forcing users to hunt through settings:

- Missing Kite API key/secret
- Zerodha authentication pending
- Zerodha token expired
- Missing LLM API key

A single action button sends the user to `/settings` to resolve provider/app configuration.

### Trading Settings

Added `/trading-settings` with:

- YOLO mode toggle
- Kill switch toggle
- Risk limits with defaults:
  - Daily loss: `5000`
  - Trades/day: `5`
  - Capital/trade: `25000`
  - Open positions: `3`
- Research generation settings with defaults:
  - Watchlist items: `6`
  - Trade candidates: `4`
  - GTT candidates: `3`
  - Risk style: conservative
- Field-level info icons for non-obvious controls.

### Research UX

- Simplified the main research page into a summary-first view:
  - market thesis
  - watchlist/trade/GTT/warning stats
  - watchlist preview cards
  - highest-conviction trade preview
- Moved dense research details into a right-side slide-in drawer.
- Drawer tabs:
  - Overview
  - Trades
  - GTT
  - Sources
- The overview drawer can show "Likely movers / catalyst candidates" from `session.rawPlan.discovery.candidates`, including catalyst type, validation status, score, and rationale when present.

## Backend Changes

### Configurable Research Prompt

Morning research prompts are now managed separately in `backend/src/prompts/morning-research.ts` instead of being embedded directly in service code. The service also performs a pre-prompt catalyst discovery pass and passes `discoveredCandidates` to the prompt context.

Configurable prompt inputs:

- `maxWatchlistItems`
- `maxTradeCandidates`
- `maxGttCandidates`
- `riskTolerance`

Defaults preserve the original prompt behavior:

```txt
maxWatchlistItems = 6
maxTradeCandidates = 4
maxGttCandidates = 3
riskTolerance = conservative
```

### Research Settings API

Added:

```txt
PUT /settings/research
```

The endpoint validates and stores research settings in `user_settings.provider_config`, while preserving existing provider/model settings.

### Server-Side Enforcement

Research candidate limits and grounding are enforced in multiple places:

1. Pre-market catalyst discovery settings limit source fan-out and candidate shortlist size.
2. Prompt instructions sent to the LLM.
3. Server-side normalization after LLM output is parsed.
4. GTT validation rejects candidates without grounded reference price, target, and stop-loss context.

Fallback research generation also respects configured limits and risk tolerance.

## Validation

- Backend typecheck passed.
- Frontend typecheck passed.
