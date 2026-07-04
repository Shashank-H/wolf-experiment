import { useMutation, useQuery } from '@tanstack/react-query';
import { Card, EmptyState, ErrorNote, SkeletonRows } from '../components/ui';
import { api } from '../lib/api';
import { formatMoney, formatNumber } from '../lib/format';
import { queryClient } from '../queryClient';
import type { Holding, Moneyish, Position } from '../types';

function metricTitle(query: { isLoading: boolean; error: unknown }, value: Moneyish) {
  if (query.isLoading) return 'loading';
  if (query.error) return 'unavailable';
  return formatMoney(value);
}

export function PortfolioPage() {
  const pnl = useQuery({ queryKey: ['portfolio', 'pnl'], queryFn: () => api<{ pnl: { holdingsPnl: number; positionsPnl: number; totalPnl: number; holdingsCount: number; positionsCount: number } }>('/portfolio/pnl') });
  const holdings = useQuery({ queryKey: ['portfolio', 'holdings'], queryFn: () => api<{ holdings: Holding[] }>('/portfolio/holdings') });
  const positions = useQuery({ queryKey: ['portfolio', 'positions'], queryFn: () => api<{ positions: Position[] }>('/portfolio/positions') });
  const sync = useMutation({
    mutationFn: () => api('/portfolio/sync', { method: 'POST' }),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['portfolio'] }),
      queryClient.invalidateQueries({ queryKey: ['settings'] }),
    ]),
  });

  return (
    <div className="page-stack">
      <div className="page-actions"><button className="secondary" disabled={sync.isPending} onClick={() => sync.mutate()}>{sync.isPending ? 'Syncing…' : 'Sync portfolio'}</button></div>
      {sync.error && <ErrorNote error={sync.error} />}
      <div className="metric-grid">
        <Card title="Total PnL"><div className="metric">{metricTitle(pnl, pnl.data?.pnl.totalPnl)}</div></Card>
        <Card title="Holdings"><div className="metric">{pnl.data?.pnl.holdingsCount ?? 0}</div></Card>
        <Card title="Positions"><div className="metric">{pnl.data?.pnl.positionsCount ?? 0}</div></Card>
      </div>
      <Card title="Holdings">
        {holdings.error ? <ErrorNote error={holdings.error} /> : holdings.isLoading ? <SkeletonRows /> : holdings.data?.holdings.length ? <HoldingsTable rows={holdings.data.holdings} /> : <EmptyState>No holdings snapshot yet.</EmptyState>}
      </Card>
      <Card title="Positions">
        {positions.error ? <ErrorNote error={positions.error} /> : positions.isLoading ? <SkeletonRows /> : positions.data?.positions.length ? <PositionsTable rows={positions.data.positions} /> : <EmptyState>No positions synced yet.</EmptyState>}
      </Card>
    </div>
  );
}

function HoldingsTable({ rows }: { rows: Holding[] }) {
  return <div className="table-wrap"><table><thead><tr><th>Symbol</th><th>Qty</th><th>Avg</th><th>LTP</th><th>PnL</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.exchange}:{row.tradingsymbol}</strong></td><td>{formatNumber(row.quantity)}</td><td>{formatMoney(row.averagePrice)}</td><td>{formatMoney(row.lastPrice)}</td><td>{formatMoney(row.pnl)}</td></tr>)}</tbody></table></div>;
}

function PositionsTable({ rows }: { rows: Position[] }) {
  return <div className="table-wrap"><table><thead><tr><th>Symbol</th><th>Product</th><th>Qty</th><th>Day</th><th>PnL</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.exchange}:{row.tradingsymbol}</strong></td><td>{row.product ?? '-'}</td><td>{formatNumber(row.quantity)}</td><td>{formatNumber(row.dayQuantity)}</td><td>{formatMoney(row.pnl)}</td></tr>)}</tbody></table></div>;
}
