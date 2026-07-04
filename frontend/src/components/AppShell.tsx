import { Link, Outlet, useRouter, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { queryClient } from '../queryClient';
import type { MeResponse, Theme } from '../types';
import { AuthPanel } from './AuthPanel';

const navItems = [
  { to: '/', label: 'Home' },
  { to: '/today', label: 'Today' },
  { to: '/history', label: 'History' },
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/trading-settings', label: 'Trading settings' },
] as const;

const todaySectionItems = [
  { to: '/today', label: 'Summary' },
  { to: '/today/research', label: 'Research' },
  { to: '/today/gtt', label: 'GTT' },
  { to: '/today/triggers', label: 'Triggers' },
  { to: '/today/approvals', label: 'Approvals' },
  { to: '/today/orders', label: 'Orders' },
] as const;

const pageTitles: Record<string, string> = {
  '/': 'Command center',
  '/today': 'Today',
  '/today/research': 'Research',
  '/today/gtt': 'GTT',
  '/today/triggers': 'Triggers',
  '/today/approvals': 'Approvals',
  '/today/orders': 'Orders',
  '/history': 'History',
  '/portfolio': 'Portfolio',
  '/orders': 'Orders',
  '/research': 'Morning research',
  '/triggers': 'Trigger rules',
  '/gtt': 'GTT orders',
  '/approvals': 'Approvals',
  '/trading-settings': 'Trading settings',
  '/settings': 'App settings',
  '/zerodha/callback': 'Zerodha callback',
};

export function AppShell() {
  const [theme, setTheme] = useState<Theme>(() => (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const router = useRouter();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeResponse>('/auth/me'), retry: false });
  const pageTitle = useMemo(() => pageTitles[pathname] ?? (pathname.startsWith('/history/') ? 'History replay' : 'Wolf'), [pathname]);
  const isLoggedOut = !me.isLoading && (me.isError || !me.data?.user);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    queryClient.clear();
    await router.navigate({ to: '/' });
    await queryClient.invalidateQueries({ queryKey: ['me'] });
  }

  if (me.isLoading) {
    return <main className="auth-main" />;
  }

  if (isLoggedOut) {
    return (
      <main className="auth-main">
        <AuthPanel />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="primary-nav" aria-label="Primary">
        <Link to="/" className="brand" aria-label="Wolf home">WOLF</Link>
        <nav className="nav-links">
          {navItems.map((item) => <Link key={item.to} to={item.to} className="tab" activeProps={{ className: 'tab active' }}>{item.label}</Link>)}
        </nav>
        <div className="nav-actions">
          <div className="nav-icon-row">
            <button className="icon-button secondary" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'} title={theme === 'light' ? 'Dark mode' : 'Light mode'}>
              {theme === 'light' ? <MoonIcon /> : <SunIcon />}
            </button>
            <Link to="/settings" className="icon-button icon-link secondary" aria-label="Open app settings" title="App settings">
              <GearIcon />
            </Link>
          </div>
          <button className="secondary" onClick={logout}>Logout</button>
        </div>
      </aside>
      <section className="app-content">
        <header className="page-head app-page-head">
          <h1>{pageTitle}</h1>
        </header>
        {pathname.startsWith('/today') && (
          <nav className="today-route-tabs" aria-label="Today sections">
            {todaySectionItems.map((item) => <Link key={item.to} to={item.to} className={pathname === item.to ? 'active' : ''}>{item.label}</Link>)}
          </nav>
        )}
        <Outlet />
      </section>
    </main>
  );
}

function MoonIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.7A8.5 8.5 0 0 1 8.3 3.8 8.5 8.5 0 1 0 20.2 15.7Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function SunIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}

function GearIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.4A3.4 3.4 0 1 0 12 8.6a3.4 3.4 0 0 0 0 6.8Z" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.4-2.4 1a8.2 8.2 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.6A8.2 8.2 0 0 0 7 6.6l-2.4-1-2 3.4 2 1.5c-.1.5-.1 1-.1 1.5s0 1 .1 1.5l-2 1.5 2 3.4 2.4-1a8.2 8.2 0 0 0 2.6 1.5l.4 2.6h4l.4-2.6a8.2 8.2 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>;
}
