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
  maxGttCandidates: '3',
  riskTolerance: 'conservative',
};

export function TradingSettingsPage() {
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsResponse>('/settings') });
  const [message, setMessage] = useState('');
  const [yolo, setYolo] = useState(false);
  const [killSwitch, setKillSwitch] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [autoGttManagement, setAutoGttManagement] = useState(false);
  const [schedule, setSchedule] = useState({ tradingSchedulerEnabled: false, morningResearchTimeIst: '08:45', eodRcaTimeIst: '15:35', tradingLoopIntervalMinutes: '5' });
  const [trading, setTrading] = useState(DEFAULT_RISK_LIMITS);
  const [research, setResearch] = useState(DEFAULT_RESEARCH);

  useEffect(() => {
    const preferences = settings.data?.tradingPreferences;
    const config = settings.data?.settings?.providerConfig ?? {};
    setYolo(Boolean(settings.data?.settings?.yoloModeEnabled));
    setKillSwitch(Boolean(settings.data?.settings?.killSwitchEnabled));
    setDryRun(Boolean(settings.data?.settings?.dryRunModeEnabled));
    setAutoGttManagement(Boolean(settings.data?.settings?.autoGttManagementEnabled || settings.data?.settings?.yoloModeEnabled));
    setSchedule({
      tradingSchedulerEnabled: Boolean(settings.data?.settings?.tradingSchedulerEnabled),
      morningResearchTimeIst: settings.data?.settings?.morningResearchTimeIst ?? '08:45',
      eodRcaTimeIst: settings.data?.settings?.eodRcaTimeIst ?? '15:35',
      tradingLoopIntervalMinutes: String(settings.data?.settings?.tradingLoopIntervalMinutes ?? 5),
    });
    setTrading({
      maxDailyLoss: String(preferences?.maxDailyLoss ?? DEFAULT_RISK_LIMITS.maxDailyLoss),
      maxTradesPerDay: String(preferences?.maxTradesPerDay ?? DEFAULT_RISK_LIMITS.maxTradesPerDay),
      maxCapitalPerTrade: String(preferences?.maxCapitalPerTrade ?? DEFAULT_RISK_LIMITS.maxCapitalPerTrade),
      maxOpenPositions: String(preferences?.maxOpenPositions ?? DEFAULT_RISK_LIMITS.maxOpenPositions),
    });
    setResearch({
      maxWatchlistItems: String(config.maxWatchlistItems ?? DEFAULT_RESEARCH.maxWatchlistItems),
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

  async function toggleAutoGttManagement() {
    if (yolo) return;
    const next = !autoGttManagement;
    setAutoGttManagement(next);
    try {
      await api('/settings/auto-gtt-management', { method: 'PUT', body: JSON.stringify({ enabled: next }) });
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      setMessage(`Auto GTT management ${next ? 'enabled' : 'disabled'}`);
    } catch (error) {
      setAutoGttManagement(!next);
      setMessage(error instanceof Error ? error.message : 'Could not update auto GTT management');
    }
  }

  async function saveSchedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api('/settings/schedule', { method: 'PUT', body: JSON.stringify({ ...schedule, tradingLoopIntervalMinutes: Number(schedule.tradingLoopIntervalMinutes) }) });
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      setMessage('Schedule settings saved');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save schedule settings');
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
      await api('/settings/research', { method: 'PUT', body: JSON.stringify({ maxWatchlistItems: Number(research.maxWatchlistItems), maxGttCandidates: Number(research.maxGttCandidates), riskTolerance: research.riskTolerance }) });
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
        <div className="toggle-row">
          <div><strong>Auto-manage approved GTTs</strong><p>Allows the agent to modify or cancel already-approved broker GTTs during revalidation. YOLO mode forces this on.</p></div>
          <button className={autoGttManagement ? 'switch on' : 'switch'} disabled={yolo} onClick={toggleAutoGttManagement} aria-pressed={autoGttManagement}><span />{autoGttManagement ? 'On' : 'Off'}</button>
        </div>
        {yolo && <p className="note">YOLO mode automatically enables auto GTT management.</p>}
        {message && <p className="note">[i] {message}</p>}
      </Card>

      <div className="settings-grid">
        <Card title="Trading workflow schedule" marker="[T]">
          <form onSubmit={saveSchedule} className="stack" autoComplete="off">
            <div className="toggle-row"><div><strong>Scheduled trading workflow</strong><p>Runs morning research, intraday maintenance, GTT safety review, broker sync hooks, and EOD RCA from one schedule. Dry-run vs live is decided by mode. Default: off.</p></div><button type="button" className={schedule.tradingSchedulerEnabled ? 'switch on' : 'switch'} onClick={() => setSchedule({ ...schedule, tradingSchedulerEnabled: !schedule.tradingSchedulerEnabled })}><span />{schedule.tradingSchedulerEnabled ? 'On' : 'Off'}</button></div>
            <div className="field-grid">
              <Field label="Morning research IST" info="Default 08:45."><span className="disabled-field-tooltip" data-tooltip="Enable Scheduled trading workflow before editing this time."><input disabled={!schedule.tradingSchedulerEnabled} type="time" value={schedule.morningResearchTimeIst} onChange={(e) => setSchedule({ ...schedule, morningResearchTimeIst: e.target.value })} /></span></Field>
              <Field label="EOD RCA IST" info="Default 15:35."><span className="disabled-field-tooltip" data-tooltip="Enable Scheduled trading workflow before editing this time."><input disabled={!schedule.tradingSchedulerEnabled} type="time" value={schedule.eodRcaTimeIst} onChange={(e) => setSchedule({ ...schedule, eodRcaTimeIst: e.target.value })} /></span></Field>
              <Field label="Intraday loop interval" info="Default 5 minutes. Runs GTT revalidation and other maintenance in one loop."><span className="disabled-field-tooltip" data-tooltip="Enable Scheduled trading workflow before editing this interval."><input disabled={!schedule.tradingSchedulerEnabled} value={schedule.tradingLoopIntervalMinutes} onChange={(e) => setSchedule({ ...schedule, tradingLoopIntervalMinutes: e.target.value })} type="number" min="1" max="1440" /></span></Field>
            </div>
            <p className="note">A conservative 5-minute loop is the default for Zerodha retail usage. Keep this at or above 1 minute.</p>
            <button disabled={settings.isLoading}>Save trading schedule</button>
          </form>
        </Card>

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
              <Field label="GTT candidates" info="Maximum draft GTT orders generated for review. Default 3."><input value={research.maxGttCandidates} onChange={(e) => setResearch({ ...research, maxGttCandidates: e.target.value })} name="maxGttCandidates" type="number" min="0" max="12" autoComplete="off" /></Field>
            </div>
            <Field label="Risk style" info="Controls how strict the research prompt is when selecting ideas.">
              <select value={research.riskTolerance} onChange={(e) => setResearch({ ...research, riskTolerance: e.target.value })} name="riskTolerance">
                <option value="conservative">Safe mode — fewer, high-conviction ideas</option>
                <option value="moderate">Balanced — selective but flexible</option>
                <option value="aggressive">Opportunity mode — more ideas for review</option>
              </select>
            </Field>
            <p className="note">GTT limits are enforced in Stage 2. Stage 1 trade ideas are transient and visible only through the agent log.</p>
            <button disabled={settings.isLoading}>Save research</button>
          </form>
        </Card>
      </div>
    </div>
  );
}
