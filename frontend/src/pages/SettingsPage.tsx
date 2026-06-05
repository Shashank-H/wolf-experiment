import { useQuery } from '@tanstack/react-query';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { Card, Field } from '../components/ui';
import { api } from '../lib/api';
import { queryClient } from '../queryClient';
import type { SettingsResponse } from '../types';

export function SettingsPage() {
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsResponse>('/settings') });
  const [message, setMessage] = useState('');
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
    const config = settings.data?.settings?.providerConfig ?? {};
    setProviders({
      kiteApiUrl: String(config.kiteApiUrl ?? 'https://api.kite.trade'),
      llmBaseUrl: String(config.llmBaseUrl ?? ''),
      smallModel: String(config.smallModel ?? ''),
      mediumModel: String(config.mediumModel ?? ''),
      bigModel: String(config.bigModel ?? ''),
    });
  }, [settings.data]);

  async function saveProviders(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api('/settings/providers', { method: 'PUT', body: JSON.stringify({ ...Object.fromEntries(form.entries()), ...providers }) });
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
      event.currentTarget.reset();
      setMessage('App settings saved');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save app settings');
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
      <Card title="App settings" marker="[S]">
        <p>Connect broker, market-data, and model providers here. Trading controls live on the Trading settings page.</p>
        {message && <p className="note">[i] {message}</p>}
      </Card>

      <div className="settings-grid">
        <Card title="Broker" marker="[K]">
          <form onSubmit={saveProviders} className="stack" autoComplete="off">
            <input className="autofill-decoy" type="text" name="username" autoComplete="username" tabIndex={-1} aria-hidden="true" />
            <input className="autofill-decoy" type="password" name="password" autoComplete="current-password" tabIndex={-1} aria-hidden="true" />
            <Field label="Kite API URL" info="Broker REST API endpoint. Keep the default unless using a proxy."><input value={providers.kiteApiUrl} onChange={(e) => setProviders({ ...providers, kiteApiUrl: e.target.value })} name="kiteApiUrl" type="url" autoComplete="off" data-lpignore="true" data-1p-ignore="true" /></Field>
            <div className="field-grid">
              <Field label="API key" info="Zerodha Kite Connect API key from your developer app."><input name="kiteApiKey" placeholder={savedPlaceholder('kite', 'api_key')} autoComplete="off" data-lpignore="true" data-1p-ignore="true" /></Field>
              <Field label="API secret" info="Zerodha Kite Connect API secret. Stored encrypted."><input name="kiteApiSecret" type="password" placeholder={savedPlaceholder('kite', 'api_secret')} autoComplete="new-password" data-lpignore="true" data-1p-ignore="true" /></Field>
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
            <Field label="Exa API key" info="Used for web/news research source discovery. Stored encrypted."><input name="exaApiKey" type="password" placeholder={savedPlaceholder('exa')} autoComplete="new-password" data-lpignore="true" data-1p-ignore="true" /></Field>
            <Field label="Finnhub API key" info="Used for market/news data where available. Stored encrypted."><input name="finnhubApiKey" type="password" placeholder={savedPlaceholder('finnhub')} autoComplete="new-password" data-lpignore="true" data-1p-ignore="true" /></Field>
            <button disabled={settings.isLoading}>Save data keys</button>
          </form>
        </Card>

        <Card title="Models" marker="[A]">
          <form onSubmit={saveProviders} className="stack" autoComplete="off">
            <input className="autofill-decoy" type="text" name="username" autoComplete="username" tabIndex={-1} aria-hidden="true" />
            <input className="autofill-decoy" type="password" name="password" autoComplete="current-password" tabIndex={-1} aria-hidden="true" />
            <Field label="LLM base URL" info="OpenAI-compatible API base URL. Leave blank for provider default."><input value={providers.llmBaseUrl} onChange={(e) => setProviders({ ...providers, llmBaseUrl: e.target.value })} name="llmBaseUrl" autoComplete="off" data-lpignore="true" data-1p-ignore="true" /></Field>
            <Field label="LLM API key" info="Model provider API key used for morning research. Stored encrypted."><input name="llmApiKey" type="password" placeholder={savedPlaceholder('llm')} autoComplete="new-password" data-lpignore="true" data-1p-ignore="true" /></Field>
            <div className="field-grid three-fields">
              <Field label="Small" info="Fast/cheap model for simple extraction."><input value={providers.smallModel} onChange={(e) => setProviders({ ...providers, smallModel: e.target.value })} name="smallModel" autoComplete="off" /></Field>
              <Field label="Medium" info="Balanced model for most research tasks."><input value={providers.mediumModel} onChange={(e) => setProviders({ ...providers, mediumModel: e.target.value })} name="mediumModel" autoComplete="off" /></Field>
              <Field label="Big" info="Highest quality model for final plan generation."><input value={providers.bigModel} onChange={(e) => setProviders({ ...providers, bigModel: e.target.value })} name="bigModel" autoComplete="off" /></Field>
            </div>
            <button disabled={settings.isLoading}>Save models</button>
          </form>
        </Card>
      </div>

      {keyLabels.length > 0 && <div className="key-list">{keyLabels.map((key) => <span key={`${key.provider}:${key.label}`}>[{key.provider}:{key.label}]</span>)}</div>}
    </div>
  );
}
