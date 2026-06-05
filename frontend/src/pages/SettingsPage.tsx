import { useQuery } from '@tanstack/react-query';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Card, ErrorNote, Field } from '../components/ui';
import { api } from '../lib/api';
import { queryClient } from '../queryClient';
import type { SettingsResponse } from '../types';

export function SettingsPage() {
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsResponse>('/settings') });
  const [message, setMessage] = useState('');
  const [yolo, setYolo] = useState(false);
  const [trading, setTrading] = useState({ maxDailyLoss: '', maxTradesPerDay: '', maxCapitalPerTrade: '', maxOpenPositions: '' });
  const [providers, setProviders] = useState({ kiteApiUrl: '', llmBaseUrl: '', smallModel: '', mediumModel: '', bigModel: '' });
  const [kiteBusy, setKiteBusy] = useState(false);
  const callbackHandled = useRef(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('request_token');
    if (token && !callbackHandled.current) {
      callbackHandled.current = true;
      void completeKiteLogin(token);
    }
  }, []);

  useEffect(() => {
    const preferences = settings.data?.tradingPreferences;
    const config = settings.data?.settings?.providerConfig ?? {};
    setYolo(Boolean(settings.data?.settings?.yoloModeEnabled));
    setTrading({
      maxDailyLoss: String(preferences?.maxDailyLoss ?? ''),
      maxTradesPerDay: String(preferences?.maxTradesPerDay ?? ''),
      maxCapitalPerTrade: String(preferences?.maxCapitalPerTrade ?? ''),
      maxOpenPositions: String(preferences?.maxOpenPositions ?? ''),
    });
    setProviders({
      kiteApiUrl: config.kiteApiUrl ?? 'https://api.kite.trade',
      llmBaseUrl: config.llmBaseUrl ?? '',
      smallModel: config.smallModel ?? '',
      mediumModel: config.mediumModel ?? '',
      bigModel: config.bigModel ?? '',
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

  async function saveTrading(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api('/settings/trading', { method: 'PUT', body: JSON.stringify({ maxDailyLoss: Number(trading.maxDailyLoss), maxTradesPerDay: Number(trading.maxTradesPerDay), maxCapitalPerTrade: Number(trading.maxCapitalPerTrade), maxOpenPositions: Number(trading.maxOpenPositions) }) });
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      setMessage('Risk saved');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save risk');
    }
  }

  async function saveProviders(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api('/settings/providers', { method: 'PUT', body: JSON.stringify({ ...Object.fromEntries(form.entries()), ...providers }) });
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      event.currentTarget.reset();
      setMessage('Providers saved');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save providers');
    }
  }

  async function startKiteLogin() {
    setKiteBusy(true);
    try {
      const data = await api<{ loginUrl: string; loginState: string; tokenExpiryNote: string }>('/settings/kite/login-url');
      sessionStorage.setItem('kite_login_state', data.loginState);
      setMessage(data.tokenExpiryNote);
      window.location.href = data.loginUrl;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not start Kite login');
      setKiteBusy(false);
    }
  }

  async function completeKiteLogin(requestToken: string) {
    setKiteBusy(true);
    setMessage('Completing Zerodha login…');
    try {
      const loginState = sessionStorage.getItem('kite_login_state') ?? '';
      const data = await api<{ estimatedExpiresAt: string }>('/settings/kite/session', { method: 'POST', body: JSON.stringify({ requestToken, loginState }) });
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      sessionStorage.removeItem('kite_login_state');
      window.history.replaceState({}, document.title, '/settings');
      setMessage(`Zerodha logged in. Token valid until ${new Date(data.estimatedExpiresAt).toLocaleString()}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not complete Zerodha login');
    } finally {
      setKiteBusy(false);
    }
  }

  async function syncAll() {
    setKiteBusy(true);
    try {
      await api('/settings/sync', { method: 'POST' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
        queryClient.invalidateQueries({ queryKey: ['portfolio'] }),
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
      ]);
      setMessage('Broker sync complete');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not sync broker data');
    } finally {
      setKiteBusy(false);
    }
  }

  const keyLabels = settings.data?.providerKeys ?? [];
  const brokerAccount = settings.data?.brokerAccount;
  const kiteTokenExpired = Boolean(brokerAccount?.accessTokenExpiresAt && new Date(brokerAccount.accessTokenExpiresAt).getTime() <= Date.now());
  const kiteLoggedIn = Boolean(brokerAccount && brokerAccount.status === 'connected' && !kiteTokenExpired);
  const keySaved = (provider: string, label?: string) => keyLabels.some((key) => key.provider === provider && (!label || key.label === label));
  const savedPlaceholder = (provider: string, label?: string) => keySaved(provider, label) ? 'Saved — enter to replace' : '';

  return (
    <div className="settings-layout">
      <Card title="Automation" marker="[!]" className="automation-card">
        <div className="toggle-row">
          <div><strong>YOLO mode</strong><p>Risk checks stay active.</p></div>
          <button className={yolo ? 'switch on' : 'switch'} onClick={toggleYolo} aria-pressed={yolo}><span />{yolo ? 'On' : 'Off'}</button>
        </div>
        {message && <p className="note">[i] {message}</p>}
      </Card>

      <div className="settings-grid">
        <Card title="Risk limits" marker="[R]">
          {settings.error && <ErrorNote error={settings.error} />}
          <form onSubmit={saveTrading} className="stack" autoComplete="off">
            <div className="field-grid">
              <Field label="Daily loss"><input value={trading.maxDailyLoss} onChange={(e) => setTrading({ ...trading, maxDailyLoss: e.target.value })} name="maxDailyLoss" type="number" autoComplete="off" /></Field>
              <Field label="Trades / day"><input value={trading.maxTradesPerDay} onChange={(e) => setTrading({ ...trading, maxTradesPerDay: e.target.value })} name="maxTradesPerDay" type="number" autoComplete="off" /></Field>
              <Field label="Capital / trade"><input value={trading.maxCapitalPerTrade} onChange={(e) => setTrading({ ...trading, maxCapitalPerTrade: e.target.value })} name="maxCapitalPerTrade" type="number" autoComplete="off" /></Field>
              <Field label="Open positions"><input value={trading.maxOpenPositions} onChange={(e) => setTrading({ ...trading, maxOpenPositions: e.target.value })} name="maxOpenPositions" type="number" autoComplete="off" /></Field>
            </div>
            <button disabled={settings.isLoading}>Save risk</button>
          </form>
        </Card>

        <Card title="Broker" marker="[K]">
          <form onSubmit={saveProviders} className="stack" autoComplete="off">
            <input className="autofill-decoy" type="text" name="username" autoComplete="username" tabIndex={-1} aria-hidden="true" />
            <input className="autofill-decoy" type="password" name="password" autoComplete="current-password" tabIndex={-1} aria-hidden="true" />
            <Field label="Kite API URL"><input value={providers.kiteApiUrl} onChange={(e) => setProviders({ ...providers, kiteApiUrl: e.target.value })} name="kiteApiUrl" type="url" autoComplete="off" data-lpignore="true" data-1p-ignore="true" /></Field>
            <div className="field-grid">
              <Field label="API key"><input name="kiteApiKey" placeholder={savedPlaceholder('kite', 'api_key')} autoComplete="off" data-lpignore="true" data-1p-ignore="true" /></Field>
              <Field label="API secret"><input name="kiteApiSecret" type="password" placeholder={savedPlaceholder('kite', 'api_secret')} autoComplete="new-password" data-lpignore="true" data-1p-ignore="true" /></Field>
            </div>
            <button disabled={settings.isLoading}>Save credentials</button>
          </form>
          <div className="kite-login-panel">
            <p className="note">Set Zerodha redirect URL to /zerodha/callback. Kite does not provide background refresh tokens; re-auth is required after daily expiry.</p>
            <div className="broker-status-card">
              {kiteLoggedIn ? (
                <p className="note">[connected] {brokerAccount?.displayName ?? brokerAccount?.brokerUserId ?? 'Kite account'} · token valid until {brokerAccount?.accessTokenExpiresAt ? new Date(brokerAccount.accessTokenExpiresAt).toLocaleString() : 'daily reset'}</p>
              ) : kiteTokenExpired ? (
                <p className="note danger">[expired] Zerodha token expired. Please re-authenticate.</p>
              ) : keySaved('kite', 'api_key') && keySaved('kite', 'api_secret') ? (
                <p className="note">[ready] Credentials saved. Authenticate with Zerodha to generate the access token.</p>
              ) : (
                <p className="note">[setup] Save your Kite API key and API secret first.</p>
              )}
            </div>
            <div className="row">
              <button type="button" className="secondary" disabled={kiteBusy || !keySaved('kite', 'api_key') || !keySaved('kite', 'api_secret')} onClick={startKiteLogin}>{kiteTokenExpired ? 'Re-authenticate Zerodha' : kiteLoggedIn ? 'Re-authenticate' : 'Authenticate with Zerodha'}</button>
              <button type="button" className="secondary" disabled={kiteBusy || !kiteLoggedIn} onClick={syncAll}>Sync now</button>
            </div>
            {brokerAccount?.lastSyncedAt && <p className="note">Last synced {new Date(brokerAccount.lastSyncedAt).toLocaleString()}</p>}
          </div>
        </Card>

        <Card title="Market data" marker="[M]">
          <form onSubmit={saveProviders} className="stack" autoComplete="off">
            <input className="autofill-decoy" type="text" name="username" autoComplete="username" tabIndex={-1} aria-hidden="true" />
            <input className="autofill-decoy" type="password" name="password" autoComplete="current-password" tabIndex={-1} aria-hidden="true" />
            <Field label="Exa API key"><input name="exaApiKey" type="password" placeholder={savedPlaceholder('exa')} autoComplete="new-password" data-lpignore="true" data-1p-ignore="true" /></Field>
            <Field label="Finnhub API key"><input name="finnhubApiKey" type="password" placeholder={savedPlaceholder('finnhub')} autoComplete="new-password" data-lpignore="true" data-1p-ignore="true" /></Field>
            <button disabled={settings.isLoading}>Save data keys</button>
          </form>
        </Card>

        <Card title="Models" marker="[A]">
          <form onSubmit={saveProviders} className="stack" autoComplete="off">
            <input className="autofill-decoy" type="text" name="username" autoComplete="username" tabIndex={-1} aria-hidden="true" />
            <input className="autofill-decoy" type="password" name="password" autoComplete="current-password" tabIndex={-1} aria-hidden="true" />
            <Field label="LLM base URL"><input value={providers.llmBaseUrl} onChange={(e) => setProviders({ ...providers, llmBaseUrl: e.target.value })} name="llmBaseUrl" autoComplete="off" data-lpignore="true" data-1p-ignore="true" /></Field>
            <Field label="LLM API key"><input name="llmApiKey" type="password" placeholder={savedPlaceholder('llm')} autoComplete="new-password" data-lpignore="true" data-1p-ignore="true" /></Field>
            <div className="field-grid three-fields">
              <Field label="Small"><input value={providers.smallModel} onChange={(e) => setProviders({ ...providers, smallModel: e.target.value })} name="smallModel" autoComplete="off" /></Field>
              <Field label="Medium"><input value={providers.mediumModel} onChange={(e) => setProviders({ ...providers, mediumModel: e.target.value })} name="mediumModel" autoComplete="off" /></Field>
              <Field label="Big"><input value={providers.bigModel} onChange={(e) => setProviders({ ...providers, bigModel: e.target.value })} name="bigModel" autoComplete="off" /></Field>
            </div>
            <button disabled={settings.isLoading}>Save models</button>
          </form>
        </Card>
      </div>

      {keyLabels.length > 0 && <div className="key-list">{keyLabels.map((key) => <span key={`${key.provider}:${key.label}`}>[{key.provider}:{key.label}]</span>)}</div>}
    </div>
  );
}
