import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AppShell } from './components/AppShell';
import { OrdersPage } from './pages/OrdersPage';
import { OverviewPage } from './pages/OverviewPage';
import { PortfolioPage } from './pages/PortfolioPage';
import { SettingsPage } from './pages/SettingsPage';

const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: OverviewPage });
const portfolioRoute = createRoute({ getParentRoute: () => rootRoute, path: '/portfolio', component: PortfolioPage });
const ordersRoute = createRoute({ getParentRoute: () => rootRoute, path: '/orders', component: OrdersPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsPage });

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, portfolioRoute, ordersRoute, settingsRoute]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
