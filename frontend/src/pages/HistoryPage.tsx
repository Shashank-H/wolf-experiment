import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { Card, EmptyState, ErrorNote, SkeletonRows } from '../components/ui';
import { api } from '../lib/api';
import { formatMoney } from '../lib/format';
import type { DayResponse, HistoryResponse } from '../types';
import { DayWorkspace } from './TodayPage';

export function HistoryPage() {
  const history = useQuery({ queryKey: ['history'], queryFn: () => api<HistoryResponse>('/history') });
  if (history.error) return <ErrorNote error={history.error} />;
  if (history.isLoading) return <SkeletonRows />;
  const days = history.data?.days ?? [];
  return (
    <div className="page-stack">
      <section className="research-hero">
        <div><p className="eyebrow">Historical replay</p><h2>Research and execution history</h2><p className="research-thesis">Open any trading day to replay the same cockpit layout with that day&apos;s research, GTTs, triggers, approvals, orders, and RCA outputs.</p></div>
      </section>
      <Card title="Trading days" marker="[H]">
        {days.length ? <div className="history-list">{days.map((day) => <Link className="history-card" key={day.tradeDate} to="/history/$date" params={{ date: day.tradeDate }}><div><strong>{day.tradeDate}</strong><p>{day.summary.headline}</p></div><div className="history-metrics"><span>{day.summary.researchRuns} research</span><span>{day.summary.gttCandidates} GTT</span><span>{day.summary.orders} orders</span><span>{formatMoney(day.summary.pnl)}</span></div></Link>)}</div> : <EmptyState>No historical research runs yet.</EmptyState>}
      </Card>
    </div>
  );
}

export function HistoryDetailPage() {
  const { date } = useParams({ from: '/history/$date' });
  const day = useQuery({ queryKey: ['history', date], queryFn: () => api<DayResponse>(`/history/${date}`) });
  if (day.error) return <ErrorNote error={day.error} />;
  if (day.isLoading) return <SkeletonRows />;
  return <DayWorkspace day={day.data!.day} mode="history" />;
}
