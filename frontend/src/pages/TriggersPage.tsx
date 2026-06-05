import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card, EmptyState, ErrorNote, Field, SkeletonRows, StatusBadge } from '../components/ui';
import { api } from '../lib/api';
import { queryClient } from '../queryClient';
import type { TriggersResponse } from '../types';

const defaultRule = JSON.stringify({ version: 1, all: [{ field: 'ltp', op: 'gte', value: 100 }], expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }, null, 2);
const defaultOrder = JSON.stringify({ exchange: 'NSE', tradingsymbol: 'RELIANCE', transactionType: 'BUY', product: 'CNC', orderType: 'MARKET', quantity: 1, strategy: 'manual-trigger' }, null, 2);

export function TriggersPage() {
  const [name, setName] = useState('Breakout trigger');
  const [rule, setRule] = useState(defaultRule);
  const [orderDraft, setOrderDraft] = useState(defaultOrder);
  const triggers = useQuery({ queryKey: ['triggers'], queryFn: () => api<TriggersResponse>('/triggers') });
  const create = useMutation({
    mutationFn: () => api('/triggers', { method: 'POST', body: JSON.stringify({ name, rule: JSON.parse(rule), orderDraft: JSON.parse(orderDraft), status: 'active' }) }),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['triggers'] }),
      queryClient.invalidateQueries({ queryKey: ['approvals', 'pending'] }),
    ]),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/triggers/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['triggers'] }),
  });

  return (
    <div className="page-stack">
      <Card title="New trigger" marker="[+]">
        <form className="stack" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
          <Field label="Name"><input value={name} onChange={(event) => setName(event.target.value)} /></Field>
          <div className="field-grid">
            <Field label="Rule JSON" info="Condition that activates the trigger. Use allowed fields like ltp, changePercent, or volume with operators such as gte/lt. expiresAt controls when the rule becomes invalid."><textarea value={rule} onChange={(event) => setRule(event.target.value)} rows={10} /></Field>
            <Field label="Order draft JSON" info="Order template submitted for risk review after the trigger matches. It does not place an order by itself; exchange, symbol, side, product, order type, and quantity are validated first."><textarea value={orderDraft} onChange={(event) => setOrderDraft(event.target.value)} rows={10} /></Field>
          </div>
          <p className="note">Allowed trigger fields: ltp, changePercent, volume. Operators: gt, gte, lt, lte, eq. The backend rejects unknown fields and arbitrary code.</p>
          <button disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create trigger + risk check'}</button>
        </form>
        {create.error && <ErrorNote error={create.error} />}
      </Card>

      <Card title="Trigger rules" marker="[T]">
        {triggers.error ? <ErrorNote error={triggers.error} /> : triggers.isLoading ? <SkeletonRows /> : triggers.data?.triggers.length ? (
          <div className="table-wrap"><table><thead><tr><th>Name</th><th>Status</th><th>Expires</th><th>Rule</th><th>Order</th><th>Action</th></tr></thead><tbody>{triggers.data.triggers.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td><StatusBadge status={item.status} /></td><td>{new Date(item.expiresAt).toLocaleString()}</td><td><pre>{JSON.stringify(item.rule, null, 2)}</pre></td><td><pre>{JSON.stringify(item.orderDraft, null, 2)}</pre></td><td><button className="secondary tiny" disabled={cancel.isPending || item.status === 'cancelled'} onClick={() => cancel.mutate(item.id)}>Cancel</button></td></tr>)}</tbody></table></div>
        ) : <EmptyState>No trigger rules yet.</EmptyState>}
        {cancel.error && <ErrorNote error={cancel.error} />}
      </Card>
    </div>
  );
}
