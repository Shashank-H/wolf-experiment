import { Card } from '../components/ui';

export function OverviewPage() {
  return (
    <div className="page-grid three">
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
        <pre>{`wolf@desk ~ % sync portfolio\n[+] holdings: ready\n[+] positions: ready\n[+] orders: ready\n[-] broker: waiting for credentials`}</pre>
      </Card>
    </div>
  );
}
