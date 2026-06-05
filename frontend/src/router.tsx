import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AppShell } from './components/AppShell';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { OrdersPage } from './pages/OrdersPage';
import { OverviewPage } from './pages/OverviewPage';
import { PortfolioPage } from './pages/PortfolioPage';
import { ResearchPage } from './pages/ResearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { TradingSettingsPage } from './pages/TradingSettingsPage';
import { TriggersPage } from './pages/TriggersPage';

const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: OverviewPage });
const portfolioRoute = createRoute({ getParentRoute: () => rootRoute, path: '/portfolio', component: PortfolioPage });
const ordersRoute = createRoute({ getParentRoute: () => rootRoute, path: '/orders', component: OrdersPage });
const researchRoute = createRoute({ getParentRoute: () => rootRoute, path: '/research', component: ResearchPage });
const triggersRoute = createRoute({ getParentRoute: () => rootRoute, path: '/triggers', component: TriggersPage });
const approvalsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/approvals', component: ApprovalsPage });
const tradingSettingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/trading-settings', component: TradingSettingsPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsPage });
const zerodhaCallbackRoute = createRoute({ getParentRoute: () => rootRoute, path: '/zerodha/callback', component: SettingsPage });

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, portfolioRoute, ordersRoute, researchRoute, triggersRoute, approvalsRoute, tradingSettingsRoute, settingsRoute, zerodhaCallbackRoute]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
