import { useMutation, useQuery } from '@tanstack/react-query';
import { Card, EmptyState, ErrorNote, SkeletonRows, StatusBadge } from '../components/ui';
import { api } from '../lib/api';
import { formatPrice } from '../lib/format';
import { queryClient } from '../queryClient';
import type { GttCandidate, GttOrder, GttResponse } from '../types';

function rawNumber(raw: Record<string, unknown> | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = raw?.[key];
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return undefined;
}

function positiveMoney(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? value as GttCandidate['triggerPrice'] : undefined;
}

function gttEntry(item: GttCandidate | GttOrder) {
  return positiveMoney(item.triggerPrice) ?? positiveMoney(item.limitPrice) ?? rawNumber(item.raw, 'entryPrice', 'buyPrice', 'triggerPrice', 'limitPrice');
}

function gttTarget(item: GttCandidate | GttOrder) {
  return positiveMoney(item.targetPrice) ?? rawNumber(item.raw, 'targetPrice', 'target_price', 'target', 'takeProfitPrice');
}

function gttStopLoss(item: GttCandidate | GttOrder) {
  return positiveMoney(item.stopLossPrice) ?? rawNumber(item.raw, 'stopLossPrice', 'stoplossPrice', 'stop_loss_price', 'stopLoss', 'stoploss');
}

export function GttPage() {
  const gtt = useQuery({ queryKey: ['gtt'], queryFn: () => api<GttResponse>('/gtt') });
  const approve = useMutation({
    mutationFn: (id: string) => api(`/gtt/${id}/approve`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gtt'] }),
  });
  const reject = useMutation({
    mutationFn: (id: string) => api(`/gtt/${id}/reject`, { method: 'POST', body: JSON.stringify({ note: 'Rejected from UI' }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gtt'] }),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/gtt/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gtt'] }),
  });
  const revalidate = useMutation({
    mutationFn: () => api<{ checked: number; flagged: number; autoManaged?: number }>('/gtt/revalidate', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gtt'] }),
  });
  const busy = approve.isPending || reject.isPending || cancel.isPending || revalidate.isPending;

  if (gtt.error) return <ErrorNote error={gtt.error} />;
  if (gtt.isLoading) return <Card title="GTT orders" marker="[G]"><SkeletonRows /></Card>;

  const candidates = gtt.data?.candidates ?? [];
  const active = gtt.data?.gttOrders ?? [];
  const broker = gtt.data?.brokerGtts;
  const brokerStatus = gtt.data?.brokerStatus ?? (broker === null ? 'fetch_failed' : 'connected');
  const brokerUnavailable = broker === null || brokerStatus !== 'connected';

  return (
    <div className="page-grid two">
      <Card title="GTT candidates" marker="[C]">
        <p className="note">Approve places only a two-leg Kite GTT with both target and stoploss. Regular market/limit orders are disabled by design.</p>
        {candidates.length ? <div className="table-wrap"><table><thead><tr><th>Symbol</th><th>Side</th><th>Entry trigger</th><th>Target</th><th>Stoploss</th><th>Qty</th><th>Status</th><th>Rationale</th><th /></tr></thead><tbody>{candidates.map((candidate) => <tr key={candidate.id}><td>{candidate.exchange}:{candidate.tradingsymbol}</td><td>{candidate.transactionType}</td><td>{formatPrice(gttEntry(candidate))}</td><td>{formatPrice(gttTarget(candidate))}</td><td>{formatPrice(gttStopLoss(candidate))}</td><td>{candidate.quantity}</td><td><StatusBadge status={candidate.status} /></td><td>{candidate.rationale}</td><td><div className="row"><button className="tiny" disabled={busy} onClick={() => approve.mutate(candidate.id)}>Approve two-leg GTT</button><button className="tiny secondary" disabled={busy} onClick={() => reject.mutate(candidate.id)}>Reject</button></div></td></tr>)}</tbody></table></div> : <EmptyState>No GTT candidates yet.</EmptyState>}
      </Card>

      <Card title="Active app GTTs" marker="[A]">
        <div className="section-actions"><button className="tiny secondary" disabled={busy} onClick={() => revalidate.mutate()}>Revalidate active GTTs</button>{revalidate.data && <span className="note">Checked {revalidate.data.checked}; flagged {revalidate.data.flagged}; auto-managed {revalidate.data.autoManaged ?? 0}.</span>}</div>
        {active.length ? <div className="table-wrap"><table><thead><tr><th>Symbol</th><th>Broker GTT</th><th>Entry trigger</th><th>Target</th><th>Stoploss</th><th>Qty</th><th>Status</th><th>Message</th><th /></tr></thead><tbody>{active.map((order) => <tr key={order.id}><td>{order.exchange}:{order.tradingsymbol}</td><td>{order.brokerGttId ?? '-'}</td><td>{formatPrice(gttEntry(order))}</td><td>{formatPrice(gttTarget(order))}</td><td>{formatPrice(gttStopLoss(order))}</td><td>{order.quantity}</td><td><StatusBadge status={order.status} /></td><td>{order.statusMessage ?? '-'}</td><td><button className="tiny secondary" disabled={busy} onClick={() => cancel.mutate(order.id)}>Cancel GTT</button></td></tr>)}</tbody></table></div> : <EmptyState>No app-placed GTTs.</EmptyState>}
      </Card>

      <Card title="Broker status" marker="[B]" className="wide">
        {brokerUnavailable ? (
          <EmptyState>Broker GTT state unavailable: {brokerStatus === 'missing_credentials' ? 'Kite credentials or login are missing.' : 'Broker status fetch failed.'}</EmptyState>
        ) : broker?.length ? (
          <div className="table-wrap"><table><thead><tr><th>Broker GTT</th><th>Symbol</th><th>Status</th><th>Created</th></tr></thead><tbody>{broker.map((item) => <tr key={item.gttId}><td>{item.gttId}</td><td>{item.exchange ?? '-'}:{item.tradingsymbol ?? '-'}</td><td><StatusBadge status={item.status ?? 'unknown'} /></td><td>{item.createdAt ? new Date(item.createdAt).toLocaleString() : '-'}</td></tr>)}</tbody></table></div>
        ) : (
          <EmptyState>Broker connected; no broker GTTs found.</EmptyState>
        )}
      </Card>
      {(approve.error || reject.error || cancel.error || revalidate.error) && <ErrorNote error={approve.error ?? reject.error ?? cancel.error ?? revalidate.error} />}
    </div>
  );
}
