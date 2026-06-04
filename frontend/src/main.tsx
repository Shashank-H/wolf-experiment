import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const queryClient = new QueryClient();
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Request failed: ${response.status}`);
  return data;
}

function AuthPanel() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage('');
    try {
      await api(`/auth/${mode}`, { method: 'POST', body: JSON.stringify({ email, password }) });
      queryClient.invalidateQueries({ queryKey: ['me'] });
      setMessage(`${mode === 'login' ? 'Logged in' : 'Registered'} successfully`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Authentication failed');
    }
  }

  return (
    <section className="card">
      <h2>Login / Register</h2>
      <form onSubmit={submit} className="stack">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" />
        <div className="row">
          <button type="submit">{mode === 'login' ? 'Login' : 'Register'}</button>
          <button type="button" className="secondary" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            Switch to {mode === 'login' ? 'register' : 'login'}
          </button>
        </div>
      </form>
      {message && <p className="note">{message}</p>}
    </section>
  );
}

function SettingsPanel() {
  const [message, setMessage] = useState('');
  const [yolo, setYolo] = useState(false);
  const [yoloConfirmation, setYoloConfirmation] = useState('');

  async function saveTrading(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api('/settings/trading', {
        method: 'PUT',
        body: JSON.stringify({
          maxDailyLoss: Number(form.get('maxDailyLoss')),
          maxTradesPerDay: Number(form.get('maxTradesPerDay')),
          maxCapitalPerTrade: Number(form.get('maxCapitalPerTrade')),
          maxOpenPositions: Number(form.get('maxOpenPositions')),
        }),
      });
      setMessage('Trading preferences saved');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save trading preferences');
    }
  }

  async function saveProviders(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api('/settings/providers', {
        method: 'PUT',
        body: JSON.stringify(Object.fromEntries(form.entries())),
      });
      event.currentTarget.reset();
      setMessage('Provider credentials saved encrypted; decrypted values are never returned');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save provider credentials');
    }
  }

  async function toggleYolo() {
    try {
      await api('/settings/yolo-mode', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: !yolo,
          confirmation: !yolo ? yoloConfirmation : undefined,
        }),
      });
      setYolo(!yolo);
      setYoloConfirmation('');
      setMessage(`YOLO mode ${!yolo ? 'enabled' : 'disabled'} and audited`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update YOLO mode');
    }
  }

  return (
    <section className="card grid2">
      <div>
        <h2>Trading Preferences</h2>
        <form onSubmit={saveTrading} className="stack">
          <input name="maxDailyLoss" type="number" placeholder="Max daily loss" />
          <input name="maxTradesPerDay" type="number" placeholder="Max trades per day" />
          <input name="maxCapitalPerTrade" type="number" placeholder="Max capital per trade" />
          <input name="maxOpenPositions" type="number" placeholder="Max open positions" />
          <button>Save trading preferences</button>
        </form>
      </div>
      <div>
        <h2>Provider Credentials</h2>
        <form onSubmit={saveProviders} className="stack">
          <input name="kiteApiKey" placeholder="Kite API key" />
          <input name="kiteApiSecret" placeholder="Kite API secret" type="password" />
          <input name="exaApiKey" placeholder="Exa API key" type="password" />
          <input name="finnhubApiKey" placeholder="Finnhub API key" type="password" />
          <input name="llmBaseUrl" placeholder="OpenAI-compatible base URL" />
          <input name="llmApiKey" placeholder="LLM API key" type="password" />
          <input name="smallModel" placeholder="Small model" />
          <input name="mediumModel" placeholder="Medium model" />
          <input name="bigModel" placeholder="Big model" />
          <button>Save encrypted credentials</button>
        </form>
      </div>
      <div className="wide warning">
        <h2>YOLO Mode</h2>
        <p>YOLO mode can never bypass deterministic risk checks. Enabling/disabling is audited.</p>
        {!yolo && (
          <input
            value={yoloConfirmation}
            onChange={(event) => setYoloConfirmation(event.target.value)}
            placeholder="Type: I understand YOLO mode still requires risk checks"
          />
        )}
        <button onClick={toggleYolo}>{yolo ? 'Disable' : 'Enable'} YOLO mode</button>
      </div>
      {message && <p className="wide note">{message}</p>}
    </section>
  );
}

function App() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<{ user: { email: string } | null }>('/auth/me'), retry: false });
  return (
    <main>
      <header>
        <p className="eyebrow">Wolf Trading Copilot</p>
        <h1>Safety-first trading automation foundation</h1>
        <p>Phase 0 + Phase 1 bootstrap: auth, encrypted settings, audit-ready backend, and local infrastructure.</p>
      </header>
      <div className="status">Session: {me.data?.user?.email ?? 'not logged in'}</div>
      <AuthPanel />
      <SettingsPanel />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
