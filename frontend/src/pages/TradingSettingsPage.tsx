import { useQuery } from '@tanstack/react-query';
import type React from 'react';
import { useEffect, useState } from 'react';
import { Card, ErrorNote, Field } from '../components/ui';
import { api } from '../lib/api';
import { queryClient } from '../queryClient';
import type { SettingsResponse } from '../types';

const DEFAULT_RISK_LIMITS = {
  maxDailyLoss: '5000',
  maxTradesPerDay: '5',
  maxCapitalPerTrade: '25000',
  maxOpenPositions: '3',
};

const DEFAULT_RESEARCH = {
  maxWatchlistItems: '6',
  maxTradeCandidates: '4',
  maxGttCandidates: '3',
  riskTolerance: 'conservative',
};

export function TradingSettingsPage() {
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsResponse>('/settings') });
  const [message, setMessage] = useState('');
  const [yolo, setYolo] = useState(false);
  const [killSwitch, setKillSwitch] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [trading, setTrading] = useState(DEFAULT_RISK_LIMITS);
  const [research, setResearch] = useState(DEFAULT_RESEARCH);

  useEffect(() => {
    const preferences = settings.data?.tradingPreferences;
    const config = settings.data?.settings?.providerConfig ?? {};
    setYolo(Boolean(settings.data?.settings?.yoloModeEnabled));
    setKillSwitch(Boolean(settings.data?.settings?.killSwitchEnabled));
    setDryRun(Boolean(settings.data?.settings?.dryRunModeEnabled));
    setTrading({
      maxDailyLoss: String(preferences?.maxDailyLoss ?? DEFAULT_RISK_LIMITS.maxDailyLoss),
      maxTradesPerDay: String(preferences?.maxTradesPerDay ?? DEFAULT_RISK_LIMITS.maxTradesPerDay),
      maxCapitalPerTrade: String(preferences?.maxCapitalPerTrade ?? DEFAULT_RISK_LIMITS.maxCapitalPerTrade),
      maxOpenPositions: String(preferences?.maxOpenPositions ?? DEFAULT_RISK_LIMITS.maxOpenPositions),
    });
    setResearch({
      maxWatchlistItems: String(config.maxWatchlistItems ?? DEFAULT_RESEARCH.maxWatchlistItems),
      maxTradeCandidates: String(config.maxTradeCandidates ?? DEFAULT_RESEARCH.maxTradeCandidates),
      maxGttCandidates: String(config.maxGttCandidates ?? DEFAULT_RESEARCH.maxGttCandidates),
      riskTolerance: String(config.riskTolerance ?? DEFAULT_RESEARCH.riskTolerance),
    });
  }, [settings.data]);

  async function toggleYolo() {
    const next = !yolo;
    setYolo(next);
    try {
      await api('/settings/yolo-mode', { method: 'PUT', body: JSON.stringify({ enabled: next }) });
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      setMessage(`YOLO ${next ? 'on' : 'off'}`);
    } catch (error) {
      setYolo(!next);
      setMessage(error instanceof Error ? error.message : 'Could not update YOLO');
    }
  }

  async function toggleKillSwitch() {
    const next = !killSwitch;
    setKillSwitch(next);
    try {
      await api('/settings/kill-switch', { method: 'PUT', body: JSON.stringify({ enabled: next }) });
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      setMessage(`Kill switch ${next ? 'enabled' : 'disabled'}`);
    } catch (error) {
      setKillSwitch(!next);
      setMessage(error instanceof Error ? error.message : 'Could not update kill switch');
    }
  }

  async function toggleDryRun() {
    const next = !dryRun;
    setDryRun(next);
    try {
      await api('/settings/dry-run-mode', { method: 'PUT', body: JSON.stringify({ enabled: next }) });
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      setMessage(`Dry run mode ${next ? 'enabled' : 'disabled'}`);
    } catch (error) {
      setDryRun(!next);
      setMessage(error instanceof Error ? error.message : 'Could not update dry run mode');
    }
  }

  async function saveTrading(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api('/settings/trading', { method: 'PUT', body: JSON.stringify({ maxDailyLoss: Number(trading.maxDailyLoss), maxTradesPerDay: Number(trading.maxTradesPerDay), maxCapitalPerTrade: Number(trading.maxCapitalPerTrade), maxOpenPositions: Number(trading.maxOpenPositions) }) });
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      setMessage('Risk limits saved');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save risk limits');
    }
  }

  async function saveResearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api('/settings/research', { method: 'PUT', body: JSON.stringify({ maxWatchlistItems: Number(research.maxWatchlistItems), maxTradeCandidates: Number(research.maxTradeCandidates), maxGttCandidates: Number(research.maxGttCandidates), riskTolerance: research.riskTolerance }) });
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      setMessage('Research settings saved');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save research settings');
    }
  }

  return (
    <div className="settings-layout">
      <Card title="Automation" marker="[!]" className="automation-card">
        <div className="toggle-row">
          <div><strong>YOLO mode</strong><p>Risk checks stay active. Approval can be skipped only when risk allows.</p></div>
          <button className={yolo ? 'switch on' : 'switch'} onClick={toggleYolo} aria-pressed={yolo}><span />{yolo ? 'On' : 'Off'}</button>
        </div>
        <div className="toggle-row">
          <div><strong>Kill switch</strong><p>Blocks all new trigger risk decisions while enabled.</p></div>
          <button className={killSwitch ? 'switch on' : 'switch'} onClick={toggleKillSwitch} aria-pressed={killSwitch}><span />{killSwitch ? 'On' : 'Off'}</button>
        </div>
        <div className="toggle-row">
          <div><strong>Global dry run mode</strong><p>Blocks broker placement across the system. The MVP flow still tracks simulated orders and EOD PnL for RCA learning.</p></div>
          <button className={dryRun ? 'switch on' : 'switch'} onClick={toggleDryRun} aria-pressed={dryRun}><span />{dryRun ? 'On' : 'Off'}</button>
        </div>
        {message && <p className="note">[i] {message}</p>}
      </Card>

      <div className="settings-grid">
        <Card title="Risk limits" marker="[R]">
          {settings.error && <ErrorNote error={settings.error} />}
          <form onSubmit={saveTrading} className="stack" autoComplete="off">
            <div className="field-grid">
              <Field label="Daily loss" info="Maximum realized day loss allowed before new trades are blocked. Default ₹5,000."><input value={trading.maxDailyLoss} onChange={(e) => setTrading({ ...trading, maxDailyLoss: e.target.value })} name="maxDailyLoss" type="number" min="0" autoComplete="off" /></Field>
              <Field label="Trades / day" info="Maximum broker orders allowed per day. Default 5."><input value={trading.maxTradesPerDay} onChange={(e) => setTrading({ ...trading, maxTradesPerDay: e.target.value })} name="maxTradesPerDay" type="number" min="0" autoComplete="off" /></Field>
              <Field label="Capital / trade" info="Maximum estimated capital deployed in one trade. Default ₹25,000."><input value={trading.maxCapitalPerTrade} onChange={(e) => setTrading({ ...trading, maxCapitalPerTrade: e.target.value })} name="maxCapitalPerTrade" type="number" min="0" autoComplete="off" /></Field>
              <Field label="Open positions" info="Maximum simultaneous open positions allowed. Default 3."><input value={trading.maxOpenPositions} onChange={(e) => setTrading({ ...trading, maxOpenPositions: e.target.value })} name="maxOpenPositions" type="number" min="0" autoComplete="off" /></Field>
            </div>
            <p className="note">Set a field to 0 only if you intentionally want to disable that specific limit.</p>
            <button disabled={settings.isLoading}>Save risk limits</button>
          </form>
        </Card>

        <Card title="Research" marker="[Q]">
          <form onSubmit={saveResearch} className="stack" autoComplete="off">
            <div className="field-grid three-fields">
              <Field label="Watchlist items" info="Maximum symbols shown in morning research. Default 6."><input value={research.maxWatchlistItems} onChange={(e) => setResearch({ ...research, maxWatchlistItems: e.target.value })} name="maxWatchlistItems" type="number" min="0" max="24" autoComplete="off" /></Field>
              <Field label="Trade candidates" info="Maximum actionable trade ideas generated for manual review. Default 4."><input value={research.maxTradeCandidates} onChange={(e) => setResearch({ ...research, maxTradeCandidates: e.target.value })} name="maxTradeCandidates" type="number" min="0" max="12" autoComplete="off" /></Field>
              <Field label="GTT candidates" info="Maximum draft GTT orders generated for review. Default 3."><input value={research.maxGttCandidates} onChange={(e) => setResearch({ ...research, maxGttCandidates: e.target.value })} name="maxGttCandidates" type="number" min="0" max="12" autoComplete="off" /></Field>
            </div>
            <Field label="Risk style" info="Controls how strict the research prompt is when selecting ideas.">
              <select value={research.riskTolerance} onChange={(e) => setResearch({ ...research, riskTolerance: e.target.value })} name="riskTolerance">
                <option value="conservative">Safe mode — fewer, high-conviction ideas</option>
                <option value="moderate">Balanced — selective but flexible</option>
                <option value="aggressive">Opportunity mode — more ideas for review</option>
              </select>
            </Field>
            <p className="note">Research limits are enforced in both the prompt and server-side cleanup.</p>
            <button disabled={settings.isLoading}>Save research</button>
          </form>
        </Card>
      </div>
    </div>
  );
}
