import { Link } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Card, EmptyState, ErrorNote, Field, SkeletonRows, StatusBadge } from '../components/ui';
import { API_BASE_URL, api } from '../lib/api';
import { formatPrice } from '../lib/format';
import { queryClient } from '../queryClient';
import type { CreateResearchRunResponse, ResearchBundle, ResearchResponse, ResearchRun, ResearchRunEvent, ResearchRunsResponse, SettingsResponse, WatchlistResponse } from '../types';

type ResearchDrawerTab = 'overview' | 'agent' | 'gtt' | 'sources';

type DiscoveredMover = {
  exchange?: string;
  tradingsymbol: string;
  changePercent?: number;
  volume?: number;
  score?: number;
  reason?: string;
  catalystType?: string;
  validationStatus?: string;
};

export function ResearchPage() {
  const [symbol, setSymbol] = useState('');
  const [reason, setReason] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<ResearchDrawerTab>('overview');
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [streamEvents, setStreamEvents] = useState<ResearchRunEvent[]>([]);
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsResponse>('/settings') });
  const research = useQuery({ queryKey: ['research', 'today'], queryFn: () => api<ResearchResponse>('/research/today') });
  const researchRuns = useQuery({ queryKey: ['research', 'runs'], queryFn: () => api<ResearchRunsResponse>('/research/runs') });
  const watchlist = useQuery({ queryKey: ['watchlist', 'today'], queryFn: () => api<WatchlistResponse>('/watchlist/today') });
  const runResearch = useMutation({
    mutationFn: () => api<CreateResearchRunResponse>('/research/runs', { method: 'POST', body: JSON.stringify({ researchType: 'pre_market', clientLocalDate: localDateInput(), clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) }),
    onSuccess: async (data) => {
      setActiveRunId(data.runId);
      setStreamEvents([]);
      await queryClient.invalidateQueries({ queryKey: ['research', 'runs'] });
    },
  });
  const addManual = useMutation({
    mutationFn: () => api('/watchlist/manual', { method: 'POST', body: JSON.stringify({ exchange: 'NSE', tradingsymbol: symbol, reason, bias: 'neutral' }) }),
    onSuccess: async () => {
      setSymbol('');
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['watchlist', 'today'] });
    },
  });
  const removeItem = useMutation({
    mutationFn: (id: string) => api(`/watchlist/${id}`, { method: 'DELETE' }),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['watchlist', 'today'] }),
  });

  const bundle = research.data?.research;
  const activeWatchlist = watchlist.data?.watchlist ?? bundle?.watchlist ?? [];
  const warningsCount = bundle?.session.riskWarnings.length ?? 0;
  const providerKeys = settings.data?.providerKeys ?? [];
  const hasKey = (provider: string, label?: string) => providerKeys.some((key) => key.provider === provider && (!label || key.label === label));
  const researchSetupIssues = [
    !hasKey('exa') ? 'Exa API key is required before research can run.' : null,
    !hasKey('llm') ? 'LLM API key is required before research can run.' : null,
  ].filter(Boolean);
  const researchSetupBlocked = researchSetupIssues.length > 0;

  useEffect(() => {
    if (!activeRunId) return;
    const source = new EventSource(`${API_BASE_URL}/research/runs/${activeRunId}/events`, { withCredentials: true });
    source.onmessage = (event) => {
      const data = JSON.parse(event.data || '{}') as Record<string, unknown>;
      setStreamEvents((current) => [...current, { id: `${activeRunId}-${String(data.sequence ?? current.length + 1)}`, runId: activeRunId, sequence: Number(data.sequence ?? current.length + 1), eventType: event.type || 'message', payload: data, createdAt: String(data.createdAt ?? new Date().toISOString()) }]);
    };
    const eventNames = ['research.queued', 'research.started', 'research.providers.validated', 'research.exa.started', 'research.exa.event', 'research.exa.completed', 'research.structured_output.validated', 'research.llm.review.started', 'research.llm_action.requested', 'research.llm_action.completed', 'research.candidates.filtered', 'research.candidates.ranked', 'research.result.ready', 'research.completed', 'research.completed_no_actionable_candidates', 'research.failed'];
    for (const name of eventNames) {
      source.addEventListener(name, (event) => {
        const data = JSON.parse((event as MessageEvent).data || '{}') as Record<string, unknown>;
        setStreamEvents((current) => [...current, { id: `${activeRunId}-${String(data.sequence ?? current.length + 1)}`, runId: activeRunId, sequence: Number(data.sequence ?? current.length + 1), eventType: name, payload: data, createdAt: String(data.createdAt ?? new Date().toISOString()) }]);
        if (name === 'research.completed' || name === 'research.completed_no_actionable_candidates' || name === 'research.failed') {
          void queryClient.invalidateQueries({ queryKey: ['research', 'runs'] });
          void queryClient.invalidateQueries({ queryKey: ['research', 'today'] });
        }
      });
    }
    source.onerror = () => void queryClient.invalidateQueries({ queryKey: ['research', 'runs'] });
    return () => source.close();
  }, [activeRunId]);

  function openDrawer(tab: ResearchDrawerTab) {
    setDrawerTab(tab);
    setDrawerOpen(true);
  }

  const latestRun = researchRuns.data?.runs[0];
  const groupedRuns = groupRunsByLocalDate(researchRuns.data?.runs ?? []);

  return (
    <div className="page-stack research-page">
      <div className="page-actions split-actions">
        <button className="secondary" onClick={() => openDrawer('overview')} disabled={!bundle}>Legacy deep dive</button>
        <button onClick={() => runResearch.mutate()} disabled={runResearch.isPending || researchSetupBlocked} title={researchSetupBlocked ? researchSetupIssues.join(' ') : undefined}>{runResearch.isPending ? 'Starting…' : 'Run research'}</button>
      </div>
      {researchSetupBlocked && (
        <Card title="Research setup required" marker="[!]">
          <ul className="plain-list">{researchSetupIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
          <Link to="/settings" className="button-link">Configure research providers</Link>
        </Card>
      )}
      {research.isLoading ? <SkeletonRows /> : research.isError ? <ErrorNote error={research.error} /> : null}
      {runResearch.isError && <ErrorNote error={runResearch.error} />}

      <Card title="Research runs" marker="[R]">
        {latestRun ? <div className="detail-block"><strong>Latest: {new Date(latestRun.createdAt).toLocaleString()} · <StatusBadge status={latestRun.status} /></strong><p>{latestRun.marketThesis || 'Research is queued/running. Progress appears below.'}</p></div> : <EmptyState>No research runs yet. Start a run to stream Exa + LLM progress.</EmptyState>}
        {streamEvents.length ? <ul className="plain-list source-list">{streamEvents.slice(-8).map((event) => <li key={event.id}><strong>{event.eventType}</strong> <span className="note">{new Date(event.createdAt).toLocaleTimeString()}</span><br /><span className="note">{eventSummary(event.payload)}</span></li>)}</ul> : null}
        {groupedRuns.length ? <div className="history-groups">{groupedRuns.map((group) => <div className="detail-block" key={group.date}><strong>{group.date}</strong><ul className="plain-list">{group.runs.map((run) => <li key={run.id}>{new Date(run.createdAt).toLocaleTimeString()} · <StatusBadge status={run.status} /> · {run.researchType} · {run.riskWarnings.length + run.providerWarnings.length} warning(s)</li>)}</ul></div>)}</div> : null}
      </Card>

      {!bundle && !research.isLoading ? <EmptyState>No legacy morning research session yet. New research runs are shown above.</EmptyState> : null}

      {bundle ? (
        <>
          <section className="research-hero">
            <div>
              <p className="eyebrow">{bundle.session.tradeDate} · model {bundle.session.model ?? 'unknown'} · <StatusBadge status={bundle.session.status} /></p>
              <h2>Market thesis</h2>
              <p className="research-thesis">{bundle.session.marketThesis}</p>
            </div>
            <div className="research-stats">
              <button className="stat-button" onClick={() => openDrawer('overview')}><span>{activeWatchlist.length}</span>Watchlist</button>
              <button className="stat-button" onClick={() => openDrawer('agent')}><span>{bundle.session.agentConversation?.messages?.length ?? 0}</span>Agent log</button>
              <button className="stat-button" onClick={() => openDrawer('gtt')}><span>{bundle.gttCandidates.length}</span>GTT</button>
              <button className={warningsCount ? 'stat-button warning' : 'stat-button'} onClick={() => openDrawer('overview')}><span>{warningsCount}</span>Warnings</button>
            </div>
          </section>

          <section className="research-summary-grid">
            <Card title="Today watchlist" marker="[W]" className="research-card">
              {activeWatchlist.length ? <div className="watch-chip-grid">{activeWatchlist.slice(0, 8).map((item) => <div className="watch-chip" key={item.id}><strong>{item.tradingsymbol}</strong><span>{item.bias} · {item.source}</span><p>{item.reason}</p></div>)}</div> : <EmptyState>No watchlist items for today.</EmptyState>}
              {activeWatchlist.length > 8 && <button className="secondary tiny" onClick={() => openDrawer('overview')}>View all {activeWatchlist.length}</button>}
            </Card>

            <Card title="Draft GTT candidates" marker="[G]" className="research-card">
              {bundle.gttCandidates.length ? bundle.gttCandidates.slice(0, 3).map((item) => (
                <button className="candidate-row" key={item.id} onClick={() => openDrawer('gtt')}>
                  <span><strong>{item.tradingsymbol}</strong><small>{item.transactionType} · qty {item.quantity}</small></span>
                  <em>{item.rationale}</em>
                </button>
              )) : <EmptyState>No GTT drafts generated.</EmptyState>}
            </Card>
          </section>
        </>
      ) : null}

      <Card title="Add manual watchlist item" marker="[+]">
        <form className="field-grid compact-form" onSubmit={(event) => { event.preventDefault(); if (symbol.trim()) addManual.mutate(); }}>
          <Field label="Symbol"><input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} placeholder="NSE equity symbol" /></Field>
          <Field label="Reason"><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Manual context" /></Field>
          <button type="submit" disabled={addManual.isPending || !symbol.trim()}>Add item</button>
        </form>
        {addManual.isError && <ErrorNote error={addManual.error} />}
      </Card>

      {bundle && <ResearchDrawer bundle={bundle} activeWatchlist={activeWatchlist} open={drawerOpen} tab={drawerTab} onTab={setDrawerTab} onClose={() => setDrawerOpen(false)} onDeleteWatchlist={(id) => removeItem.mutate(id)} deleting={removeItem.isPending} />}
    </div>
  );
}

function ResearchDrawer({ bundle, activeWatchlist, open, tab, onTab, onClose, onDeleteWatchlist, deleting }: { bundle: ResearchBundle; activeWatchlist: WatchlistResponse['watchlist']; open: boolean; tab: ResearchDrawerTab; onTab: (tab: ResearchDrawerTab) => void; onClose: () => void; onDeleteWatchlist: (id: string) => void; deleting: boolean }) {
  const discoveredMovers = getDiscoveredMovers(bundle);
  return (
    <>
      <button className={open ? 'drawer-scrim open' : 'drawer-scrim'} aria-label="Close research details" onClick={onClose} tabIndex={open ? 0 : -1} />
      <aside className={open ? 'research-drawer open' : 'research-drawer'} aria-hidden={!open}>
        <div className="drawer-head">
          <div><p className="eyebrow">Research detail</p><h2>{bundle.session.tradeDate}</h2></div>
          <button className="secondary tiny" onClick={onClose}>Close</button>
        </div>
        <div className="drawer-tabs">
          {(['overview', 'agent', 'gtt', 'sources'] as const).map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => onTab(item)}>{item}</button>)}
        </div>

        {tab === 'overview' && (
          <div className="drawer-section">
            <h2>Likely movers / catalyst candidates</h2>
            {discoveredMovers.length ? <div className="table-wrap"><table><thead><tr><th>Symbol</th><th>Catalyst</th><th>Validation</th><th>Score</th><th>Reason</th></tr></thead><tbody>{discoveredMovers.map((item) => <tr key={`${item.exchange ?? 'NSE'}:${item.tradingsymbol}`}><td><strong>{item.exchange ?? 'NSE'}:{item.tradingsymbol}</strong></td><td>{item.catalystType ?? '—'}</td><td>{item.validationStatus ?? (item.changePercent === undefined && item.volume === undefined ? 'watchlist only' : 'market data seen')}</td><td>{item.score === undefined ? '—' : item.score.toFixed(1)}</td><td>{item.reason ?? 'Catalyst-backed research candidate'}</td></tr>)}</tbody></table></div> : <EmptyState>No catalyst candidates saved for this session.</EmptyState>}
            <h2>Sector bias</h2>
            {bundle.session.sectorBias.length ? bundle.session.sectorBias.map((item) => <div className="detail-block" key={`${item.sector}-${item.bias}`}><strong>{item.sector} [{item.bias}]</strong><p>{item.reason}</p></div>) : <EmptyState>No sector bias generated.</EmptyState>}
            <h2>Risk warnings</h2>
            {bundle.session.riskWarnings.length ? <ul className="plain-list">{bundle.session.riskWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : <p>No warnings.</p>}
            <h2>Watchlist</h2>
            {activeWatchlist.length ? <div className="table-wrap"><table><thead><tr><th>Symbol</th><th>Bias</th><th>Source</th><th>Reason</th><th /></tr></thead><tbody>{activeWatchlist.map((item) => <tr key={item.id}><td><strong>{item.exchange}:{item.tradingsymbol}</strong></td><td>{item.bias}</td><td>{item.source}</td><td>{item.reason}</td><td><button className="tiny secondary" onClick={() => onDeleteWatchlist(item.id)} disabled={deleting}>Delete</button></td></tr>)}</tbody></table></div> : <EmptyState>No watchlist items.</EmptyState>}
          </div>
        )}

        {tab === 'agent' && <AgentConversationView bundle={bundle} />}

        {tab === 'gtt' && <div className="drawer-section">{bundle.gttCandidates.length ? <div className="table-wrap"><table><thead><tr><th>Symbol</th><th>Side</th><th>Entry trigger</th><th>Target</th><th>Stoploss</th><th>Qty</th><th>Status</th><th>Rationale</th></tr></thead><tbody>{bundle.gttCandidates.map((item) => <tr key={item.id}><td><strong>{item.exchange}:{item.tradingsymbol}</strong></td><td>{item.transactionType}</td><td>{formatPrice(item.triggerPrice ?? item.limitPrice)}</td><td>{formatPrice(item.targetPrice)}</td><td>{formatPrice(item.stopLossPrice)}</td><td>{item.quantity}</td><td><StatusBadge status={item.status} /></td><td>{item.rationale}</td></tr>)}</tbody></table></div> : <EmptyState>No GTT drafts generated.</EmptyState>}</div>}

        {tab === 'sources' && <div className="drawer-section">{bundle.sources.length ? <ul className="plain-list source-list">{bundle.sources.map((source) => <li key={source.id}><strong>{source.provider}</strong> {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : source.title}<br /><span className="note">{source.summary}</span></li>)}</ul> : <EmptyState>No external sources saved.</EmptyState>}</div>}
      </aside>
    </>
  );
}

function getDiscoveredMovers(bundle: ResearchBundle): DiscoveredMover[] {
  const discovery = bundle.session.rawPlan?.discovery;
  const candidates: unknown[] = Array.isArray(discovery) ? discovery : discovery && typeof discovery === 'object' && Array.isArray((discovery as Record<string, unknown>).candidates) ? (discovery as Record<string, unknown>).candidates as unknown[] : [];
  return candidates.flatMap((candidate: unknown): DiscoveredMover[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const record = candidate as Record<string, unknown>;
    const tradingsymbol = typeof record.tradingsymbol === 'string' ? record.tradingsymbol : typeof record.symbol === 'string' ? record.symbol : '';
    if (!tradingsymbol) return [];
    const ranking = record.ranking && typeof record.ranking === 'object' ? record.ranking as Record<string, unknown> : {};
    const reasons = Array.isArray(ranking.reasons) ? ranking.reasons.filter((item): item is string => typeof item === 'string') : [];
    return [{
      exchange: typeof record.exchange === 'string' ? record.exchange : undefined,
      tradingsymbol,
      changePercent: finiteNumber(record.changePercent),
      volume: finiteNumber(record.volume),
      score: finiteNumber(record.score) ?? finiteNumber(ranking.score),
      reason: typeof record.reason === 'string' ? record.reason : reasons[0],
      catalystType: typeof record.catalystType === 'string' ? record.catalystType : undefined,
      validationStatus: typeof record.validationStatus === 'string' ? record.validationStatus.replace(/_/g, ' ') : undefined,
    }];
  }).slice(0, 8);
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function localDateInput(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function groupRunsByLocalDate(runs: ResearchRun[]) {
  const groups = new Map<string, ResearchRun[]>();
  for (const run of runs) {
    const date = new Date(run.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    groups.set(date, [...(groups.get(date) ?? []), run]);
  }
  return [...groups.entries()].map(([date, groupRuns]) => ({ date, runs: groupRuns }));
}

function eventSummary(payload: Record<string, unknown>): string {
  const error = typeof payload.error === 'string' ? payload.error : '';
  if (error) return error;
  const status = typeof payload.status === 'string' ? payload.status : '';
  const providers = Array.isArray(payload.providers) ? `providers: ${payload.providers.join(', ')}` : '';
  const counts = ['sources', 'candidates', 'watchlist', 'warnings', 'returnedSources'].flatMap((key) => typeof payload[key] === 'number' ? [`${key}: ${payload[key]}`] : []);
  return [status, providers, ...counts].filter(Boolean).join(' · ') || JSON.stringify(payload).slice(0, 180);
}

function formatPercent(value: number | undefined): string {
  return value === undefined ? '—' : `${value.toFixed(2)}%`;
}

function formatNumber(value: number | undefined): string {
  return value === undefined ? '—' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value);
}

function AgentConversationView({ bundle }: { bundle: ResearchBundle }) {
  const conversation = bundle.session.agentConversation;
  const messages = conversation?.messages ?? [];
  const thoughts = conversation?.thoughtDetails ?? [];
  if (!conversation || (!messages.length && !thoughts.length)) return <div className="drawer-section"><EmptyState>No stored agent conversation for this research run.</EmptyState></div>;
  return (
    <div className="drawer-section agent-deep-dive">
      <div className="llm-run-card">
        <div>
          <p className="eyebrow">Agent run</p>
          <h2>{conversation.provider ?? 'agent'} · {conversation.model ?? bundle.session.model ?? 'unknown model'}</h2>
        </div>
        <StatusBadge status={conversation.status ?? 'stored'} />
        {conversation.startedAt && <span className="note">{new Date(conversation.startedAt).toLocaleString()}</span>}
      </div>

      {thoughts.length ? (
        <section className="thought-stream" aria-label="Thought details">
          <div className="section-kicker"><span />Thought details</div>
          {thoughts.map((thought, index) => (
            <article className="thought-card" key={`${thought.title}-${index}`}>
              <div className="thought-index">{String(index + 1).padStart(2, '0')}</div>
              <div>
                <h3>{thought.title}</h3>
                <p>{thought.detail}</p>
                {thought.metadata && Object.keys(thought.metadata).length ? <code>{JSON.stringify(thought.metadata)}</code> : null}
              </div>
            </article>
          ))}
        </section>
      ) : null}

      <section className="chat-transcript" aria-label="Full agent conversation">
        <div className="section-kicker"><span />Full conversation</div>
        {messages.map((message, index) => (
          <article className={`chat-bubble ${message.role}`} key={`${message.role}-${index}`}>
            <div className="chat-role"><strong>{message.role}</strong>{message.createdAt && <small>{new Date(message.createdAt).toLocaleTimeString()}</small>}</div>
            <pre>{message.content}</pre>
          </article>
        ))}
      </section>
    </div>
  );
}
