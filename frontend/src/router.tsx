import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AppShell } from './components/AppShell';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { GttPage } from './pages/GttPage';
import { HistoryDetailPage, HistoryPage } from './pages/HistoryPage';
import { OrdersPage } from './pages/OrdersPage';
import { OverviewPage } from './pages/OverviewPage';
import { PortfolioPage } from './pages/PortfolioPage';
import { ResearchPage } from './pages/ResearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { TodayPage } from './pages/TodayPage';
import { TradingSettingsPage } from './pages/TradingSettingsPage';
import { TriggersPage } from './pages/TriggersPage';

const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: OverviewPage });
const todayRoute = createRoute({ getParentRoute: () => rootRoute, path: '/today', component: TodayPage });
const todayResearchRoute = createRoute({ getParentRoute: () => rootRoute, path: '/today/research', component: ResearchPage });
const todayGttRoute = createRoute({ getParentRoute: () => rootRoute, path: '/today/gtt', component: GttPage });
const todayTriggersRoute = createRoute({ getParentRoute: () => rootRoute, path: '/today/triggers', component: TriggersPage });
const todayApprovalsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/today/approvals', component: ApprovalsPage });
const todayOrdersRoute = createRoute({ getParentRoute: () => rootRoute, path: '/today/orders', component: OrdersPage });
const historyRoute = createRoute({ getParentRoute: () => rootRoute, path: '/history', component: HistoryPage });
const historyDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: '/history/$date', component: HistoryDetailPage });
const portfolioRoute = createRoute({ getParentRoute: () => rootRoute, path: '/portfolio', component: PortfolioPage });
const ordersRoute = createRoute({ getParentRoute: () => rootRoute, path: '/orders', component: OrdersPage });
const researchRoute = createRoute({ getParentRoute: () => rootRoute, path: '/research', component: ResearchPage });
const triggersRoute = createRoute({ getParentRoute: () => rootRoute, path: '/triggers', component: TriggersPage });
const gttRoute = createRoute({ getParentRoute: () => rootRoute, path: '/gtt', component: GttPage });
const approvalsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/approvals', component: ApprovalsPage });
const tradingSettingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/trading-settings', component: TradingSettingsPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsPage });
const zerodhaCallbackRoute = createRoute({ getParentRoute: () => rootRoute, path: '/zerodha/callback', component: SettingsPage });

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, todayRoute, todayResearchRoute, todayGttRoute, todayTriggersRoute, todayApprovalsRoute, todayOrdersRoute, historyRoute, historyDetailRoute, portfolioRoute, ordersRoute, researchRoute, triggersRoute, gttRoute, approvalsRoute, tradingSettingsRoute, settingsRoute, zerodhaCallbackRoute]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
