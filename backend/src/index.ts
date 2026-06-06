import cors from '@elysiajs/cors';
import { Elysia } from 'elysia';
import { env } from './config/env';
import { authRoutes } from './routes/auth';
import { healthRoutes } from './routes/health';
import { orderRoutes } from './routes/orders';
import { portfolioRoutes } from './routes/portfolio';
import { researchRoutes } from './routes/research';
import { settingsRoutes } from './routes/settings';
import { triggerRoutes } from './routes/triggers';
import { startDryRunScheduler } from './services/dry-run-scheduler';
import { safeDatabaseMessage } from './utils/db-errors';

const allowedOrigins = env.FRONTEND_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);

export const app = new Elysia()
  .use(cors({ origin: allowedOrigins, credentials: true }))
  .use(healthRoutes)
  .use(authRoutes)
  .use(settingsRoutes)
  .use(portfolioRoutes)
  .use(orderRoutes)
  .use(researchRoutes)
  .use(triggerRoutes)
  .onError(({ code, error, set }) => {
    if (code === 'NOT_FOUND') return { error: 'Not found' };
    set.status = 500;
    const message = error instanceof Error ? error.message : '';
    return { error: message.includes('Failed query') ? safeDatabaseMessage(error) : message || 'Internal server error' };
  });

if (import.meta.main) {
  app.listen(env.APP_PORT);
  startDryRunScheduler();
  console.log(`Wolf backend listening on http://localhost:${env.APP_PORT}`);
}
