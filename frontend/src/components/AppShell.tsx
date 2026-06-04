import { Link, Outlet, useRouter, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { queryClient } from '../queryClient';
import type { MeResponse, Theme } from '../types';
import { AuthPanel } from './AuthPanel';

const navItems = [
  { to: '/', label: 'Home' },
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/orders', label: 'Orders' },
  { to: '/settings', label: 'Settings' },
] as const;

const pageTitles: Record<string, string> = {
  '/': 'Command center',
  '/portfolio': 'Portfolio',
  '/orders': 'Orders',
  '/settings': 'Settings',
};

export function AppShell() {
  const [theme, setTheme] = useState<Theme>(() => (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const router = useRouter();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeResponse>('/auth/me'), retry: false });
  const pageTitle = useMemo(() => pageTitles[pathname] ?? 'Wolf', [pathname]);
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
    <main>
      <nav className="primary-nav" aria-label="Primary">
        <Link to="/" className="brand" aria-label="Wolf home">WOLF</Link>
        <div className="nav-links">
          {navItems.map((item) => <Link key={item.to} to={item.to} className="tab" activeProps={{ className: 'tab active' }}>{item.label}</Link>)}
        </div>
        <div className="nav-actions">
          <button className="icon-button secondary" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'} title={theme === 'light' ? 'Dark mode' : 'Light mode'}>
            {theme === 'light' ? <MoonIcon /> : <SunIcon />}
          </button>
          <button className="secondary" onClick={logout}>Logout</button>
        </div>
      </nav>
      <header className="page-head">
        <div><h1>{pageTitle}</h1><p>Session: {me.data?.user?.email}</p></div>
        <div className="status-line">[{theme}] [{pathname === '/' ? 'home' : pathname.slice(1)}]</div>
      </header>
      <Outlet />
    </main>
  );
}

function MoonIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 15.7A8.5 8.5 0 0 1 8.3 3.8 8.5 8.5 0 1 0 20.2 15.7Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function SunIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}
