import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card, EmptyState, ErrorNote, Field, SkeletonRows, StatusBadge } from '../components/ui';
import { api } from '../lib/api';
import { formatMoney } from '../lib/format';
import { queryClient } from '../queryClient';
import type { ResearchBundle, ResearchResponse, WatchlistResponse } from '../types';

type ResearchDrawerTab = 'overview' | 'trades' | 'gtt' | 'sources';

export function ResearchPage() {
  const [symbol, setSymbol] = useState('');
  const [reason, setReason] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<ResearchDrawerTab>('overview');
  const research = useQuery({ queryKey: ['research', 'today'], queryFn: () => api<ResearchResponse>('/research/today') });
  const watchlist = useQuery({ queryKey: ['watchlist', 'today'], queryFn: () => api<WatchlistResponse>('/watchlist/today') });
  const runMorning = useMutation({
    mutationFn: () => api<ResearchResponse>('/research/run-morning', { method: 'POST' }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['research', 'today'] }),
        queryClient.invalidateQueries({ queryKey: ['watchlist', 'today'] }),
      ]);
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

  function openDrawer(tab: ResearchDrawerTab) {
    setDrawerTab(tab);
    setDrawerOpen(true);
  }

  return (
    <div className="page-stack research-page">
      <div className="page-actions split-actions">
        <button className="secondary" onClick={() => openDrawer('overview')} disabled={!bundle}>Deep dive</button>
        <button onClick={() => runMorning.mutate()} disabled={runMorning.isPending}>{runMorning.isPending ? 'Running…' : 'Run morning research'}</button>
      </div>
      {research.isLoading ? <SkeletonRows /> : research.isError ? <ErrorNote error={research.error} /> : null}
      {runMorning.isError && <ErrorNote error={runMorning.error} />}
      {!bundle && !research.isLoading ? <EmptyState>No morning research session yet. Run research to create today&apos;s thesis, watchlist, candidates and GTT drafts.</EmptyState> : null}

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
              <button className="stat-button" onClick={() => openDrawer('trades')}><span>{bundle.tradeCandidates.length}</span>Trades</button>
              <button className="stat-button" onClick={() => openDrawer('gtt')}><span>{bundle.gttCandidates.length}</span>GTT</button>
              <button className={warningsCount ? 'stat-button warning' : 'stat-button'} onClick={() => openDrawer('overview')}><span>{warningsCount}</span>Warnings</button>
            </div>
          </section>

          <section className="research-summary-grid">
            <Card title="Today watchlist" marker="[W]" className="research-card">
              {activeWatchlist.length ? <div className="watch-chip-grid">{activeWatchlist.slice(0, 8).map((item) => <div className="watch-chip" key={item.id}><strong>{item.tradingsymbol}</strong><span>{item.bias} · {item.source}</span><p>{item.reason}</p></div>)}</div> : <EmptyState>No watchlist items for today.</EmptyState>}
              {activeWatchlist.length > 8 && <button className="secondary tiny" onClick={() => openDrawer('overview')}>View all {activeWatchlist.length}</button>}
            </Card>

            <Card title="Highest conviction" marker="[T]" className="research-card">
              {bundle.tradeCandidates.length ? bundle.tradeCandidates.slice(0, 3).map((item) => (
                <button className="candidate-row" key={item.id} onClick={() => openDrawer('trades')}>
                  <span><strong>{item.tradingsymbol}</strong><small>{item.side} · {item.confidence}% confidence</small></span>
                  <em>{item.thesis}</em>
                </button>
              )) : <EmptyState>No trade candidates generated.</EmptyState>}
            </Card>
          </section>
        </>
      ) : null}

      <Card title="Add manual watchlist item" marker="[+]">
        <form className="field-grid compact-form" onSubmit={(event) => { event.preventDefault(); if (symbol.trim()) addManual.mutate(); }}>
          <Field label="Symbol"><input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} placeholder="RELIANCE" /></Field>
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
  return (
    <>
      <button className={open ? 'drawer-scrim open' : 'drawer-scrim'} aria-label="Close research details" onClick={onClose} tabIndex={open ? 0 : -1} />
      <aside className={open ? 'research-drawer open' : 'research-drawer'} aria-hidden={!open}>
        <div className="drawer-head">
          <div><p className="eyebrow">Research detail</p><h2>{bundle.session.tradeDate}</h2></div>
          <button className="secondary tiny" onClick={onClose}>Close</button>
        </div>
        <div className="drawer-tabs">
          {(['overview', 'trades', 'gtt', 'sources'] as const).map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => onTab(item)}>{item}</button>)}
        </div>

        {tab === 'overview' && (
          <div className="drawer-section">
            <h2>Sector bias</h2>
            {bundle.session.sectorBias.length ? bundle.session.sectorBias.map((item) => <div className="detail-block" key={`${item.sector}-${item.bias}`}><strong>{item.sector} [{item.bias}]</strong><p>{item.reason}</p></div>) : <EmptyState>No sector bias generated.</EmptyState>}
            <h2>Risk warnings</h2>
            {bundle.session.riskWarnings.length ? <ul className="plain-list">{bundle.session.riskWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : <p>No warnings.</p>}
            <h2>Watchlist</h2>
            {activeWatchlist.length ? <div className="table-wrap"><table><thead><tr><th>Symbol</th><th>Bias</th><th>Source</th><th>Reason</th><th /></tr></thead><tbody>{activeWatchlist.map((item) => <tr key={item.id}><td><strong>{item.exchange}:{item.tradingsymbol}</strong></td><td>{item.bias}</td><td>{item.source}</td><td>{item.reason}</td><td><button className="tiny secondary" onClick={() => onDeleteWatchlist(item.id)} disabled={deleting}>Delete</button></td></tr>)}</tbody></table></div> : <EmptyState>No watchlist items.</EmptyState>}
          </div>
        )}

        {tab === 'trades' && <div className="drawer-section">{bundle.tradeCandidates.length ? bundle.tradeCandidates.map((item) => <div className="detail-block" key={item.id}><strong>{item.exchange}:{item.tradingsymbol} · {item.side} · {item.confidence}%</strong><p>{item.thesis}</p><p className="note">Entry: {item.entryPlan}</p><p className="note">Invalidation: {item.invalidation}</p></div>) : <EmptyState>No trade candidates generated.</EmptyState>}</div>}

        {tab === 'gtt' && <div className="drawer-section">{bundle.gttCandidates.length ? <div className="table-wrap"><table><thead><tr><th>Symbol</th><th>Txn</th><th>Trigger</th><th>Limit</th><th>Qty</th><th>Status</th><th>Rationale</th></tr></thead><tbody>{bundle.gttCandidates.map((item) => <tr key={item.id}><td><strong>{item.exchange}:{item.tradingsymbol}</strong></td><td>{item.transactionType}</td><td>{formatMoney(item.triggerPrice)}</td><td>{formatMoney(item.limitPrice)}</td><td>{item.quantity}</td><td><StatusBadge status={item.status} /></td><td>{item.rationale}</td></tr>)}</tbody></table></div> : <EmptyState>No GTT drafts generated.</EmptyState>}</div>}

        {tab === 'sources' && <div className="drawer-section">{bundle.sources.length ? <ul className="plain-list source-list">{bundle.sources.map((source) => <li key={source.id}><strong>{source.provider}</strong> {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : source.title}<br /><span className="note">{source.summary}</span></li>)}</ul> : <EmptyState>No external sources saved.</EmptyState>}</div>}
      </aside>
    </>
  );
}
