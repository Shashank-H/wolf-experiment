import { useMutation, useQuery } from '@tanstack/react-query';
import { Card, EmptyState, ErrorNote, SkeletonRows, StatusBadge } from '../components/ui';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';
import { queryClient } from '../queryClient';
import type { Order } from '../types';

export function OrdersPage() {
  const orders = useQuery({ queryKey: ['orders'], queryFn: () => api<{ orders: Order[] }>('/orders') });
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/orders/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orders'] }),
  });

  return (
    <Card title="Orders">
      {orders.error ? <ErrorNote error={orders.error} /> : orders.isLoading ? <SkeletonRows /> : orders.data?.orders.length ? (
        <div className="table-wrap"><table><thead><tr><th>Order</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Filled</th><th>Status</th><th>Action</th></tr></thead><tbody>{orders.data.orders.map((order) => <tr key={order.id}><td>{order.brokerOrderId ?? order.id.slice(0, 8)}</td><td><strong>{order.exchange ?? 'NSE'}:{order.tradingsymbol ?? '-'}</strong></td><td>{order.transactionType ?? '-'}</td><td>{formatNumber(order.quantity)}</td><td>{formatNumber(order.filledQuantity)}</td><td><StatusBadge status={order.status} /></td><td><button className="secondary tiny" disabled={cancel.isPending || !['created', 'risk_validated', 'pending_approval', 'approved', 'submitted', 'open'].includes(order.status)} onClick={() => cancel.mutate(order.id)}>Cancel</button></td></tr>)}</tbody></table></div>
      ) : <EmptyState>No orders yet.</EmptyState>}
      {cancel.error && <ErrorNote error={cancel.error} />}
    </Card>
  );
}
