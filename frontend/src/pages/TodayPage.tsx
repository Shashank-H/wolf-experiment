import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Card, EmptyState, ErrorNote, SkeletonRows, StatusBadge } from '../components/ui';
import { api } from '../lib/api';
import { formatMoney, formatPrice } from '../lib/format';
import type { DayBundle, DayResponse } from '../types';

type DayTab = 'summary' | 'research' | 'gtt' | 'triggers' | 'approvals' | 'orders' | 'rca';

const tabs: Array<{ id: DayTab; label: string }> = [
  { id: 'summary', label: 'Summary' },
  { id: 'research', label: 'Research' },
  { id: 'gtt', label: 'GTT' },
  { id: 'triggers', label: 'Triggers' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'orders', label: 'Orders' },
  { id: 'rca', label: 'Dry-run / RCA' },
];

export function TodayPage() {
  const day = useQuery({ queryKey: ['day', 'today'], queryFn: () => api<DayResponse>('/today') });
  if (day.error) return <ErrorNote error={day.error} />;
  if (day.isLoading) return <SkeletonRows />;
  return <SummaryTab day={day.data!.day} mode="today" />;
}

export function DayWorkspace({ day, mode }: { day: DayBundle; mode: 'today' | 'history' }) {
  const [tab, setTab] = useState<DayTab>('summary');
  const readOnly = mode === 'history';
  return (
    <div className="page-stack">
      <div className="today-topbar">
        <div className="drawer-tabs today-tabs inline-tabs" role="tablist" aria-label={mode === 'today' ? 'Today sections' : 'History replay sections'}>
          {tabs.map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}
        </div>
        {mode === 'today' ? <Link to="/history" className="button-link secondary">View history</Link> : <Link to="/today" className="button-link secondary">Back to today</Link>}
      </div>

      {readOnly && <p className="note">History replay is read-only. It uses the same daily cockpit layout, scoped to saved data from {day.tradeDate}.</p>}
      {tab === 'summary' && <SummaryTab day={day} mode={mode} setTab={setTab} />}
      {tab === 'research' && <ResearchTab day={day} />}
      {tab === 'gtt' && <GttTab day={day} />}
      {tab === 'triggers' && <TriggersTab day={day} />}
      {tab === 'approvals' && <ApprovalsTab day={day} />}
      {tab === 'orders' && <OrdersTab day={day} />}
      {tab === 'rca' && <RcaTab day={day} />}
    </div>
  );
}


function SummaryTab({ day, mode, setTab }: { day: DayBundle; mode: 'today' | 'history'; setTab?: (tab: DayTab) => void }) {
  const metric = (tab: Exclude<DayTab, 'summary' | 'orders' | 'rca'>, count: number, label: string, warning = false) => {
    if (setTab) return <button className={warning ? 'stat-button warning' : 'stat-button'} onClick={() => setTab(tab)}><span>{count}</span>{label}</button>;
    return <Link className={warning ? 'stat-button warning' : 'stat-button'} to={`/today/${tab}` as never}><span>{count}</span>{label}</Link>;
  };
  return <div className="page-stack">
    <section className="research-hero">
      <div>
        <p className="eyebrow">{mode === 'today' ? 'Today cockpit' : 'Historical replay'} · {day.tradeDate}</p>
        <h2>{day.summary.headline}</h2>
        <p className="research-thesis">{day.primarySession?.marketThesis ?? 'No research thesis saved for this day yet.'}</p>
      </div>
      <div className="research-stats">
        {metric('research', day.summary.researchRuns, 'Research')}
        {metric('gtt', day.summary.gttCandidates, 'GTT')}
        {metric('triggers', day.summary.triggers, 'Triggers')}
        {metric('approvals', day.summary.pendingApprovals, 'Pending', day.summary.pendingApprovals > 0)}
      </div>
    </section>
    <div className="page-grid three">
      <Card title="Execution" marker="[E]"><div className="metric-list"><p><strong>{day.summary.orders}</strong> orders</p><p><strong>{day.summary.placedOrders}</strong> placed / active</p><p><strong>{formatMoney(day.summary.pnl)}</strong> PnL</p></div></Card>
      <Card title="Risk queue" marker="[Q]"><div className="metric-list"><p><strong>{day.summary.approvals}</strong> approvals</p><p><strong>{day.summary.pendingApprovals}</strong> pending</p><p><strong>{day.summary.rcaReports}</strong> RCA reports</p></div></Card>
      <Card title="Market automation" marker="[M]"><div className="metric-list"><p><strong>{day.summary.triggers}</strong> triggers</p><p><strong>{day.summary.activeGtts}</strong> active GTTs</p><p><strong>{day.summary.gttCandidates}</strong> GTT drafts</p></div></Card>
    </div>
  </div>;
}

function ResearchTab({ day }: { day: DayBundle }) {
  return <div className="page-grid two">
    <Card title="Research runs" marker="[R]">
      {day.researchSessions.length ? <div className="table-wrap"><table><thead><tr><th>Type</th><th>Status</th><th>Model</th><th>Created</th></tr></thead><tbody>{day.researchSessions.map((session) => <tr key={session.id}><td>{session.id === day.dryRunSession?.id ? 'Dry-run' : 'Live/current'}</td><td><StatusBadge status={session.status} /></td><td>{session.model ?? '-'}</td><td>{new Date(session.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div> : <EmptyState>No research runs for this day.</EmptyState>}
    </Card>
    <Card title="Watchlist" marker="[W]">
      {day.watchlist.length ? <div className="watch-chip-grid">{day.watchlist.map((item) => <div className="watch-chip" key={item.id}><strong>{item.tradingsymbol}</strong><span>{item.bias} · {item.source}</span><p>{item.reason}</p></div>)}</div> : <EmptyState>No watchlist items.</EmptyState>}
    </Card>
    <Card title="Sources" marker="[S]" className="wide">
      {day.sources.length ? <ul className="plain-list source-list">{day.sources.map((source) => <li key={source.id}><strong>{source.provider}</strong> {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : source.title}<br /><span className="note">{source.summary}</span></li>)}</ul> : <EmptyState>No saved sources.</EmptyState>}
    </Card>
  </div>;
}

function GttTab({ day }: { day: DayBundle }) {
  return <div className="page-grid two">
    <Card title="GTT candidates" marker="[C]">{day.gttCandidates.length ? <div className="table-wrap"><table><thead><tr><th>Symbol</th><th>Side</th><th>Entry trigger</th><th>Target</th><th>Stoploss</th><th>Qty</th><th>Status</th><th>Rationale</th></tr></thead><tbody>{day.gttCandidates.map((item) => <tr key={item.id}><td>{item.exchange}:{item.tradingsymbol}</td><td>{item.transactionType}</td><td>{formatPrice(item.triggerPrice ?? item.limitPrice)}</td><td>{formatPrice(item.targetPrice)}</td><td>{formatPrice(item.stopLossPrice)}</td><td>{item.quantity}</td><td><StatusBadge status={item.status} /></td><td>{item.rationale}</td></tr>)}</tbody></table></div> : <EmptyState>No GTT candidates.</EmptyState>}</Card>
    <Card title="App-placed GTTs" marker="[A]">{day.gttOrders.length ? <div className="table-wrap"><table><thead><tr><th>Symbol</th><th>Broker GTT</th><th>Target</th><th>Stoploss</th><th>Status</th></tr></thead><tbody>{day.gttOrders.map((item) => <tr key={item.id}><td>{item.exchange}:{item.tradingsymbol}</td><td>{item.brokerGttId ?? '-'}</td><td>{formatMoney(item.targetPrice ?? item.triggerPrice)}</td><td>{formatMoney(item.stopLossPrice ?? item.limitPrice)}</td><td><StatusBadge status={item.status} /></td></tr>)}</tbody></table></div> : <EmptyState>No app GTTs.</EmptyState>}</Card>
  </div>;
}

function TriggersTab({ day }: { day: DayBundle }) {
  return <div className="page-grid two">
    <Card title="Trigger rules" marker="[T]">{day.triggers.length ? <div className="table-wrap"><table><thead><tr><th>Name</th><th>Status</th><th>Expires</th><th>Rule</th></tr></thead><tbody>{day.triggers.map((item) => <tr key={item.id}><td>{item.name}</td><td><StatusBadge status={item.status} /></td><td>{new Date(item.expiresAt).toLocaleString()}</td><td><pre>{JSON.stringify(item.rule, null, 2)}</pre></td></tr>)}</tbody></table></div> : <EmptyState>No triggers.</EmptyState>}</Card>
    <Card title="Trigger events" marker="[E]">{day.triggerEvents.length ? <div className="table-wrap"><table><thead><tr><th>Event</th><th>Matched</th><th>Message</th><th>When</th></tr></thead><tbody>{day.triggerEvents.map((item) => <tr key={item.id}><td>{item.eventType}</td><td>{item.matched ? 'yes' : 'no'}</td><td>{item.message ?? '-'}</td><td>{new Date(item.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div> : <EmptyState>No trigger events.</EmptyState>}</Card>
  </div>;
}

function ApprovalsTab({ day }: { day: DayBundle }) {
  return <Card title="Approvals" marker="[A]">{day.approvals.length ? <div className="table-wrap"><table><thead><tr><th>Status</th><th>Action</th><th>Rationale</th><th>Payload</th><th>Created</th></tr></thead><tbody>{day.approvals.map((item) => <tr key={item.id}><td><StatusBadge status={item.status} /></td><td>{item.requestedAction}</td><td>{item.rationale}</td><td><pre>{JSON.stringify(item.payload, null, 2)}</pre></td><td>{new Date(item.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div> : <EmptyState>No approvals.</EmptyState>}</Card>;
}

function OrdersTab({ day }: { day: DayBundle }) {
  return <div className="page-grid two">
    <Card title="Orders" marker="[O]">{day.orders.length ? <div className="table-wrap"><table><thead><tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Avg</th><th>Status</th><th>Created</th></tr></thead><tbody>{day.orders.map((item) => <tr key={item.id}><td>{item.exchange}:{item.tradingsymbol}</td><td>{item.transactionType}</td><td>{item.quantity}</td><td>{formatMoney(item.averagePrice)}</td><td><StatusBadge status={item.status} /></td><td>{new Date(item.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div> : <EmptyState>No orders.</EmptyState>}</Card>
    <Card title="Order events" marker="[E]">{day.orderEvents.length ? <div className="table-wrap"><table><thead><tr><th>Event</th><th>Status</th><th>Message</th><th>When</th></tr></thead><tbody>{day.orderEvents.map((item) => <tr key={item.id}><td>{item.eventType}</td><td>{item.brokerStatus ?? '-'}</td><td>{item.message ?? '-'}</td><td>{new Date(item.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div> : <EmptyState>No order events.</EmptyState>}</Card>
  </div>;
}

function RcaTab({ day }: { day: DayBundle }) {
  return <Card title="Dry-run / RCA" marker="[R]">{day.rcaReports.length ? day.rcaReports.map((report) => <div className="detail-block" key={report.id}><strong>{formatMoney(report.totalPnl)} · {report.dailySummary}</strong>{report.strategyReview && <p>{report.strategyReview}</p>}{report.agentReasoningReview && <p className="note">Agent: {report.agentReasoningReview}</p>}{report.riskReview && <p className="note">Risk: {report.riskReview}</p>}</div>) : <EmptyState>No RCA reports for this day.</EmptyState>}</Card>;
}
