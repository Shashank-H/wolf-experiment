import { useMutation, useQuery } from '@tanstack/react-query';
import { Card, EmptyState, ErrorNote, SkeletonRows, StatusBadge } from '../components/ui';
import { api } from '../lib/api';
import { queryClient } from '../queryClient';
import type { ApprovalsResponse } from '../types';

export function ApprovalsPage() {
  const approvals = useQuery({ queryKey: ['approvals', 'pending'], queryFn: () => api<ApprovalsResponse>('/approvals/pending') });
  const approve = useMutation({
    mutationFn: (id: string) => api(`/approvals/${id}/approve`, { method: 'POST', body: JSON.stringify({ note: 'Approved from UI' }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['approvals', 'pending'] }),
  });
  const reject = useMutation({
    mutationFn: (id: string) => api(`/approvals/${id}/reject`, { method: 'POST', body: JSON.stringify({ note: 'Rejected from UI' }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['approvals', 'pending'] }),
  });

  return (
    <Card title="Pending approvals" marker="[A]">
      <p className="note">Approvals are internal app decisions only. Wolf never places regular market/limit orders; broker-side trading is limited to two-leg Kite GTTs from the GTT page.</p>
      {approvals.error ? <ErrorNote error={approvals.error} /> : approvals.isLoading ? <SkeletonRows /> : approvals.data?.approvals.length ? (
        <div className="table-wrap"><table><thead><tr><th>Action</th><th>Status</th><th>Payload</th><th>Rationale</th><th>Requested</th><th /></tr></thead><tbody>{approvals.data.approvals.map((approval) => <tr key={approval.id}><td>{approval.requestedAction}</td><td><StatusBadge status={approval.status} /></td><td><pre>{JSON.stringify(approval.payload, null, 2)}</pre></td><td>{approval.rationale}</td><td>{new Date(approval.createdAt).toLocaleString()}</td><td><div className="row"><button className="tiny" disabled={approve.isPending || reject.isPending} onClick={() => approve.mutate(approval.id)}>Approve</button><button className="tiny secondary" disabled={approve.isPending || reject.isPending} onClick={() => reject.mutate(approval.id)}>Reject</button></div></td></tr>)}</tbody></table></div>
      ) : <EmptyState>No approvals pending.</EmptyState>}
      {(approve.error || reject.error) && <ErrorNote error={approve.error ?? reject.error} />}
    </Card>
  );
}
