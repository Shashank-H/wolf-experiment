---
id: user-guide
title: Wolf User Guide
sidebar_label: User Guide
slug: /user-guide
---

# Wolf User Guide

Wolf is a trading command center for running market research, managing watchlists, reviewing GTT candidates, monitoring orders, and controlling safety settings from one web app.

This guide is written for Docusaurus and includes direct app links. If your Wolf frontend is hosted at the same origin as these docs, the links open the app pages directly. If your docs are hosted separately, replace the relative app URLs with your frontend base URL.

## Quick navigation

| Task | App page |
| --- | --- |
| Check the command center | [Home](/) |
| Review today’s full trading timeline | [Today](/today) |
| Run or inspect morning research | [Research](/today/research) |
| Approve/reject GTT candidates | [GTT](/today/gtt) |
| Review trigger rules | [Triggers](/today/triggers) |
| Review pending approvals | [Approvals](/today/approvals) |
| Monitor orders | [Orders](/today/orders) |
| Browse past days | [History](/history) |
| Check holdings, positions, and PnL | [Portfolio](/portfolio) |
| Configure trading risk and automation | [Trading settings](/trading-settings) |
| Connect broker and AI/data providers | [App settings](/settings) |

## Sign in and account setup

When you open Wolf while signed out, the app shows the **Account** panel.

1. Open the app.
2. Enter your email address.
3. Enter your password.
4. Select **Login**.
5. If you do not have an account yet, select **Register**, enter the same fields, and submit.

After login, Wolf loads the main app shell with the primary navigation on the left.

:::tip
Use the **Logout** button in the left sidebar when you finish a session, especially on shared machines.
:::

## App layout

Wolf has two levels of navigation:

### Primary sidebar

The primary sidebar is always visible after login:

- [Home](/) — command center overview.
- [Today](/today) — today’s trading day summary and timeline.
- [History](/history) — past trading days and replay pages.
- [Portfolio](/portfolio) — holdings, positions, and PnL.
- [Trading settings](/trading-settings) — risk controls, scheduler, and research settings.
- [App settings](/settings) — available from the gear icon for credentials, broker login, and provider models.

The sidebar also includes:

- A light/dark theme toggle.
- A gear icon linking to [App settings](/settings).
- **Logout**.

### Today section tabs

When you are anywhere under [Today](/today), Wolf shows a second tab bar:

- [Summary](/today)
- [Research](/today/research)
- [GTT](/today/gtt)
- [Triggers](/today/triggers)
- [Approvals](/today/approvals)
- [Orders](/today/orders)

Use these tabs to move between the major parts of the current trading day without leaving today’s workflow.

## Recommended first-time setup

Before using Wolf for live or simulated trading, complete these setup steps.

### 1. Configure app settings

Open [App settings](/settings).

Use this page to configure credentials and integrations:

- Save provider credentials.
- Connect or refresh the Zerodha/Kite broker session.
- Sync broker data.
- Save data-provider keys.
- Save AI model configuration.

A typical setup flow is:

1. Add the required API keys and model settings.
2. Save credentials.
3. Start the broker login flow if using Kite/Zerodha.
4. Return to Wolf after broker authorization.
5. Select **Sync now** to refresh holdings, positions, and orders.

:::caution
Do not share screenshots or logs that expose API keys, access tokens, or broker credentials.
:::

### 2. Configure trading settings

Open [Trading settings](/trading-settings).

This page controls how aggressively Wolf can act and when automation runs.

Important controls include:

- **YOLO mode** — enables higher-risk behavior when supported by the configured strategy.
- **Kill switch** — stops trading automation when enabled.
- **Dry-run mode** — keeps execution simulated instead of live.
- **Auto GTT management** — allows Wolf to manage GTT-related automation.
- **Trading schedule** — controls research, EOD RCA, trading loop, and GTT revalidation schedules.
- **Risk limits** — controls maximum daily loss, maximum trades per day, maximum capital per trade, and maximum open positions.
- **Research profile** — choose conservative, moderate, or aggressive research behavior.

Recommended first-time safety posture:

1. Keep **Dry-run mode** enabled.
2. Keep conservative or moderate research settings.
3. Set strict daily loss and capital-per-trade limits.
4. Leave **Kill switch** available and test that it stops automation as expected.
5. Only move toward live execution after reviewing several dry-run days in [History](/history).

## Home: command center

Open [Home](/).

The Home page is the top-level command center. Use it to orient yourself before going into a specific workflow. It links the day’s operational state with configured settings and the broader automation posture.

Use Home when you want to answer:

- Is the app configured?
- Is the system in dry-run or live mode?
- Are safety controls enabled?
- Which workflow should I open next?

Common next steps from Home:

- Go to [Today](/today) to inspect the current trading day.
- Go to [Research](/today/research) to run or review market research.
- Go to [Trading settings](/trading-settings) to adjust automation or risk limits.
- Go to [App settings](/settings) to fix missing credentials or broker session issues.

## Today: daily trading summary

Open [Today](/today).

The Today page is the main daily operations view. It summarizes the current trade date and shows the major objects Wolf created or observed during the day.

You can use the page tabs to inspect:

- Research sessions.
- Watchlist items.
- Research sources.
- GTT candidates.
- GTT orders.
- Trigger rules and trigger events.
- Approval requests.
- Broker orders and order events.
- RCA reports.
- Execution and risk status.
- Market automation status.

Use Today at the start, middle, and end of a trading session:

1. Start at [Today](/today) to check the headline and counts.
2. Open [Research](/today/research) if research is missing or stale.
3. Open [GTT](/today/gtt) to review candidate trades.
4. Open [Approvals](/today/approvals) for any pending human decisions.
5. Open [Orders](/today/orders) to confirm broker execution state.
6. Return to [Today](/today) for a final daily overview.

## Research: market thesis, sources, and watchlist

Open [Research](/today/research). A top-level shortcut also exists at [Morning research](/research).

The Research page shows the current research bundle for the day, including:

- Market thesis.
- Likely movers and catalyst candidates.
- Sector bias.
- Risk warnings.
- Watchlist.
- GTT candidate previews.
- Provider warnings.
- Agent conversation and reasoning details.
- Research sources.

### Run morning research

Use **Run morning research** to request a fresh research session for the current trading day.

After the run completes, review:

1. **Market thesis** — the high-level read on the market.
2. **Likely movers / catalyst candidates** — symbols that may deserve attention.
3. **Sector bias** — sector-level directional context and reasons.
4. **Risk warnings** — reasons to reduce size, avoid trades, or stay defensive.
5. **Watchlist** — symbols selected for monitoring.
6. **GTT candidates** — trade setups that may need approval.

:::note
Research depends on configured data and AI providers. If the page shows provider warnings, visit [App settings](/settings) and verify credentials and model settings.
:::

### Use the research drawer

The page includes drawer views for deeper inspection:

- Overview details.
- Agent conversation.
- GTT candidate details.

Use these details before approving any trade setup. The agent conversation can help you understand why a symbol was selected and which assumptions were used.

### Add a manual watchlist item

The Research page lets you add a manual watchlist item using:

- NSE equity symbol.
- Manual context.

Use manual items when you want Wolf to track a symbol that was not found automatically, or when you have external context that should be visible in the day’s workflow.

## GTT: candidates and broker GTT orders

Open [GTT](/today/gtt). A top-level shortcut also exists at [GTT orders](/gtt).

The GTT page has two major responsibilities:

1. Review pending GTT candidates generated by research.
2. Inspect and manage active broker GTT orders.

### Review GTT candidates

For each GTT candidate, inspect:

- Exchange and symbol.
- Transaction type.
- Trigger price.
- Limit price.
- Target price.
- Stop-loss price.
- Quantity.
- Rationale.
- Current status.

Available actions may include:

- **Approve two-leg GTT** — approves the candidate and creates/places the GTT according to configured execution mode and broker availability.
- **Reject** — marks the candidate as rejected.

:::caution
Approving a GTT candidate can create a real broker instruction when live execution is enabled and broker credentials are valid. Confirm dry-run/live mode in [Trading settings](/trading-settings) before approving.
:::

### Revalidate active GTTs

Use **Revalidate active GTTs** to refresh active GTT status against broker state. This is useful when:

- The broker session was recently reconnected.
- Orders were changed outside Wolf.
- GTT status looks stale.
- You want to confirm active protection orders before market close.

### Cancel a GTT

Use **Cancel GTT** for an active GTT order you no longer want to keep. After canceling, refresh/revalidate to confirm the broker state updated.

If broker status is unavailable, go to [App settings](/settings) and reconnect or resync broker credentials.

## Triggers: rule-based execution conditions

Open [Triggers](/today/triggers). A top-level shortcut also exists at [Trigger rules](/triggers).

The Triggers page lists active trigger rules. Each rule contains:

- Rule name.
- Status.
- Rule definition.
- Order draft.
- Expiration time.
- Creation time.

Use this page to understand what conditions Wolf is monitoring. When a trigger is no longer appropriate, use **Cancel**.

Trigger events also appear on [Today](/today), where you can review whether conditions matched and what market context was observed.

## Approvals: human-in-the-loop actions

Open [Approvals](/today/approvals). A top-level shortcut also exists at [Approvals](/approvals).

The Approvals page lists pending approval requests. Each approval includes:

- Requested action.
- Payload.
- Rationale.
- Status.
- Creation time.

Available actions:

- **Approve** — allows Wolf to continue with the requested action.
- **Reject** — blocks the requested action.

Use approvals as a safety checkpoint. Before approving, cross-check the request with:

- The related research in [Research](/today/research).
- Any related GTT candidate in [GTT](/today/gtt).
- Current risk controls in [Trading settings](/trading-settings).

## Orders: broker order monitoring

Open [Orders](/today/orders). A top-level shortcut also exists at [Orders](/orders).

The Orders page lists broker orders known to Wolf. Each order can include:

- Broker order ID.
- Exchange and symbol.
- Transaction type.
- Quantity.
- Filled quantity.
- Average price.
- Status.
- Creation time.

Common actions:

- **Sync** — refresh orders from the broker.
- **Cancel** — request cancellation of an order that is still cancelable.

Use this page after any approval, GTT placement, or trigger event to verify the broker-visible order status.

## Portfolio: holdings, positions, and PnL

Open [Portfolio](/portfolio).

The Portfolio page shows account exposure and performance:

- **Total PnL** — current profit/loss summary.
- **Holdings** — delivery holdings with quantity, average price, last price, and PnL.
- **Positions** — intraday or product-specific positions.

Use **Sync** to refresh data from the broker.

Review Portfolio before approving new trades to avoid over-concentration or exceeding your intended capital exposure.

## History: past trading days and replay

Open [History](/history).

History lists prior trading days with daily summaries. Select a day to open its replay page at:

```text
/history/YYYY-MM-DD
```

For example:

```text
/history/2026-06-14
```

Use history to review:

- Past research runs.
- GTT candidates and orders.
- Trigger behavior.
- Approvals and execution.
- Orders and order events.
- RCA reports.
- Dry-run results.

A good review workflow is:

1. Open [History](/history).
2. Select a prior day.
3. Compare research thesis against actual execution and PnL.
4. Read RCA reports.
5. Adjust [Trading settings](/trading-settings) before the next session.

## Trading settings: risk and automation controls

Open [Trading settings](/trading-settings).

This is the most important safety page in Wolf.

### Mode controls

Use these controls to define the execution posture:

- **Dry-run mode**: simulate behavior without live broker execution.
- **Kill switch**: halt automation.
- **YOLO mode**: allow higher-risk decisions where implemented.
- **Auto GTT management**: let Wolf manage GTT workflows automatically.

Recommended usage:

- Keep dry-run enabled while testing.
- Use the kill switch immediately if behavior looks wrong.
- Avoid YOLO mode unless you understand the strategy implications.
- Enable auto GTT management only after broker credentials and GTT sync have been validated.

### Trading schedule

The schedule controls automated timing, including:

- Morning research time in IST.
- EOD RCA time in IST.
- Trading loop interval in minutes.
- GTT revalidation scheduler and interval.

After editing schedule fields, select **Save trading schedule**.

### Risk limits

Risk limits can include:

- Maximum daily loss.
- Maximum trades per day.
- Maximum capital per trade.
- Maximum open positions.

After editing limits, select **Save risk limits**.

### Research profile

Research can be configured as:

- **Conservative** — stricter, lower-risk filtering.
- **Moderate** — balanced filtering.
- **Aggressive** — broader or more risk-tolerant opportunities.

Select **Save research** after changing this profile.

## App settings: integrations and credentials

Open [App settings](/settings).

Use this page when Wolf cannot fetch data, place/sync broker orders, or run AI research.

Typical settings categories:

- Provider credentials.
- Broker account/session status.
- Kite/Zerodha login URL and callback flow.
- Data provider keys.
- AI provider/model settings.

### Broker connection flow

A common broker connection flow is:

1. Open [App settings](/settings).
2. Generate or open the Kite login URL.
3. Complete broker login and authorization.
4. Return through the callback route at [/zerodha/callback](/zerodha/callback).
5. Confirm the broker account status is connected.
6. Select **Sync now**.
7. Verify data on [Portfolio](/portfolio), [Orders](/orders), and [GTT](/gtt).

### Provider troubleshooting

If research fails or shows warnings:

1. Open [App settings](/settings).
2. Confirm AI provider keys are saved.
3. Confirm the selected model is available.
4. Confirm data provider credentials are present.
5. Save changes.
6. Return to [Research](/today/research) and run morning research again.

## Daily operating playbook

Use this sequence for a structured trading day.

### Before market open

1. Open [Trading settings](/trading-settings).
2. Confirm dry-run/live mode, kill switch, and risk limits.
3. Open [App settings](/settings) and verify broker/provider status.
4. Open [Portfolio](/portfolio) and sync holdings/positions.
5. Open [Research](/today/research) and run morning research.
6. Review thesis, sector bias, risk warnings, watchlist, and candidates.

### During market hours

1. Monitor [Today](/today) for summary changes.
2. Review [Triggers](/today/triggers) and trigger events.
3. Check [Approvals](/today/approvals) before any human-gated action.
4. Review [GTT](/today/gtt) before approving candidates.
5. Use [Orders](/today/orders) to sync and confirm broker status.
6. Use [Portfolio](/portfolio) to watch exposure and PnL.

### After market close

1. Open [Orders](/orders) and sync final order state.
2. Open [Portfolio](/portfolio) and sync final positions/PnL.
3. Review [Today](/today) for RCA reports and order events.
4. Open [History](/history) after the day is archived.
5. Adjust [Trading settings](/trading-settings) based on findings.

## Safety checklist

Before approving any action that can affect broker state, verify:

- [ ] You know whether Wolf is in dry-run or live mode.
- [ ] The kill switch is in the intended state.
- [ ] Broker credentials are connected and recently synced.
- [ ] Risk limits are appropriate for the day.
- [ ] The research thesis and risk warnings support the action.
- [ ] The symbol, quantity, prices, target, and stop loss are correct.
- [ ] You understand what will happen after approval.

## Troubleshooting

### I am redirected to the login panel

Your session is missing or expired. Log in again from the Account panel.

### Research does not run

Check:

- [App settings](/settings) for provider credentials and model configuration.
- Network/API availability.
- Provider warnings shown on [Research](/today/research).

### Broker data is stale

Try:

1. Open [App settings](/settings).
2. Reconnect broker if needed.
3. Select **Sync now**.
4. Open [Portfolio](/portfolio), [Orders](/orders), and [GTT](/gtt) to verify updated data.

### GTT status looks wrong

Open [GTT](/today/gtt) and select **Revalidate active GTTs**. If revalidation fails, reconnect broker credentials in [App settings](/settings).

### I want to stop automation immediately

Open [Trading settings](/trading-settings) and enable the **Kill switch**. Then verify open orders on [Orders](/orders) and broker GTT state on [GTT](/gtt).

## Route reference

| Route | Purpose |
| --- | --- |
| [/](/) | Home command center |
| [/today](/today) | Current day summary |
| [/today/research](/today/research) | Current day research workflow |
| [/today/gtt](/today/gtt) | Current day GTT candidates and orders |
| [/today/triggers](/today/triggers) | Current day trigger rules |
| [/today/approvals](/today/approvals) | Current day pending approvals |
| [/today/orders](/today/orders) | Current day broker orders |
| [/history](/history) | Historical trading days |
| [/history/:date](/history/2026-06-14) | Replay a specific day |
| [/portfolio](/portfolio) | Holdings, positions, and PnL |
| [/orders](/orders) | Orders shortcut |
| [/research](/research) | Research shortcut |
| [/triggers](/triggers) | Triggers shortcut |
| [/gtt](/gtt) | GTT shortcut |
| [/approvals](/approvals) | Approvals shortcut |
| [/trading-settings](/trading-settings) | Risk and automation settings |
| [/settings](/settings) | App integrations and credentials |
| [/zerodha/callback](/zerodha/callback) | Broker callback route |
