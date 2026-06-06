import { useMutation, useQuery } from '@tanstack/react-query';
import { Card, EmptyState, ErrorNote, SkeletonRows, StatusBadge } from '../components/ui';
import { api } from '../lib/api';
import { formatMoney } from '../lib/format';
import { queryClient } from '../queryClient';
import type { GttResponse } from '../types';

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
  const busy = approve.isPending || reject.isPending || cancel.isPending;

  if (gtt.error) return <ErrorNote error={gtt.error} />;
  if (gtt.isLoading) return <Card title="GTT orders" marker="[G]"><SkeletonRows /></Card>;

  const candidates = gtt.data?.candidates ?? [];
  const active = gtt.data?.gttOrders ?? [];
  const broker = gtt.data?.brokerGtts ?? [];

  return (
    <div className="page-grid two">
      <Card title="GTT candidates" marker="[C]">
        <p className="note">Approve places a live Kite GTT unless global dry-run mode or kill switch is enabled.</p>
        {candidates.length ? <div className="table-wrap"><table><thead><tr><th>Symbol</th><th>Side</th><th>Trigger</th><th>Limit</th><th>Qty</th><th>Status</th><th>Rationale</th><th /></tr></thead><tbody>{candidates.map((candidate) => <tr key={candidate.id}><td>{candidate.exchange}:{candidate.tradingsymbol}</td><td>{candidate.transactionType}</td><td>{formatMoney(candidate.triggerPrice)}</td><td>{formatMoney(candidate.limitPrice)}</td><td>{candidate.quantity}</td><td><StatusBadge status={candidate.status} /></td><td>{candidate.rationale}</td><td><div className="row"><button className="tiny" disabled={busy} onClick={() => approve.mutate(candidate.id)}>Approve</button><button className="tiny secondary" disabled={busy} onClick={() => reject.mutate(candidate.id)}>Reject</button></div></td></tr>)}</tbody></table></div> : <EmptyState>No GTT candidates yet.</EmptyState>}
      </Card>

      <Card title="Active app GTTs" marker="[A]">
        {active.length ? <div className="table-wrap"><table><thead><tr><th>Symbol</th><th>Broker GTT</th><th>Trigger</th><th>Limit</th><th>Qty</th><th>Status</th><th /></tr></thead><tbody>{active.map((order) => <tr key={order.id}><td>{order.exchange}:{order.tradingsymbol}</td><td>{order.brokerGttId ?? '-'}</td><td>{formatMoney(order.triggerPrice)}</td><td>{formatMoney(order.limitPrice)}</td><td>{order.quantity}</td><td><StatusBadge status={order.status} /></td><td><button className="tiny secondary" disabled={busy} onClick={() => cancel.mutate(order.id)}>Cancel</button></td></tr>)}</tbody></table></div> : <EmptyState>No app-placed GTTs.</EmptyState>}
      </Card>

      <Card title="Broker status" marker="[B]" className="wide">
        {broker.length ? <div className="table-wrap"><table><thead><tr><th>Broker GTT</th><th>Symbol</th><th>Status</th><th>Created</th></tr></thead><tbody>{broker.map((item) => <tr key={item.gttId}><td>{item.gttId}</td><td>{item.exchange ?? '-'}:{item.tradingsymbol ?? '-'}</td><td><StatusBadge status={item.status ?? 'unknown'} /></td><td>{item.createdAt ? new Date(item.createdAt).toLocaleString() : '-'}</td></tr>)}</tbody></table></div> : <EmptyState>No broker GTTs available, or Kite login is not connected.</EmptyState>}
      </Card>
      {(approve.error || reject.error || cancel.error) && <ErrorNote error={approve.error ?? reject.error ?? cancel.error} />}
    </div>
  );
}
