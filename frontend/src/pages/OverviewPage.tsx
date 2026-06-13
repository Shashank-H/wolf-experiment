import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Card } from '../components/ui';
import { api } from '../lib/api';
import type { SettingsResponse } from '../types';

export function OverviewPage() {
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsResponse>('/settings') });
  const keys = settings.data?.providerKeys ?? [];
  const brokerAccount = settings.data?.brokerAccount;
  const hasKey = (provider: string, label?: string) => keys.some((key) => key.provider === provider && (!label || key.label === label));
  const kiteTokenExpired = Boolean(brokerAccount?.accessTokenExpiresAt && new Date(brokerAccount.accessTokenExpiresAt).getTime() <= Date.now());
  const hasAnyResearchSource = hasKey('exa') || hasKey('finnhub');
  const setupIssues = [
    !hasKey('kite', 'api_key') || !hasKey('kite', 'api_secret') ? 'Kite API key and secret are missing.' : null,
    hasKey('kite', 'api_key') && hasKey('kite', 'api_secret') && !brokerAccount ? 'Zerodha authentication is pending.' : null,
    kiteTokenExpired ? 'Zerodha token expired; re-authentication is required.' : null,
    !hasKey('llm') ? 'LLM API key is required before morning research can run.' : null,
    !hasAnyResearchSource ? 'At least one research source provider is required: configure Exa or Finnhub.' : null,
  ].filter(Boolean);

  return (
    <div className="page-grid three">
      {setupIssues.length > 0 && (
        <Card title="Action required" marker="[!]" className="wide setup-card">
          <ul className="plain-list">{setupIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
          <Link to="/settings" className="button-link">Configure required providers in Settings</Link>
        </Card>
      )}
      <Card title="Broker" marker="[+]">
        <p>Kite profile, holdings, positions and quote reads are isolated behind an adapter.</p>
      </Card>
      <Card title="Market cache" marker="[+]">
        <p>Redis keeps live quote reads fast while snapshots persist to Postgres.</p>
      </Card>
      <Card title="Ledger" marker="[+]">
        <p>Orders and events stay visible before and after broker actions.</p>
      </Card>
      <Card title="Terminal" marker="[>]" className="terminal-card wide">
        <pre>{`wolf@desk ~ % sync portfolio\n[+] holdings: ready\n[+] positions: ready\n[+] orders: ready\n${setupIssues.length > 0 ? '[-] setup: action required' : '[+] setup: ready'}`}</pre>
      </Card>
    </div>
  );
}
