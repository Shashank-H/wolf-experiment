import postgres from 'postgres';
import { env } from '../config/env';

function explain(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : undefined;
  const message = error instanceof Error ? error.message : String(error);

  if (code === '28P01' || message.includes('password authentication failed')) {
    return [
      'Database authentication failed.',
      '',
      'Your DATABASE_URL user/password does not match the Postgres server on that port.',
      'Common local cause: an old Docker volume or another local Postgres is already using port 5432.',
      '',
      'Fix options:',
      '1. If this is disposable local data, reset Compose storage:',
      '   docker compose -f infra/docker-compose.yml down -v',
      '   docker compose -f infra/docker-compose.yml up -d postgres redis',
      '   bun run db:migrate',
      '',
      '2. Or update DATABASE_URL in .env to match the actual Postgres password/port.',
      '',
      `Current DATABASE_URL target: ${env.DATABASE_URL.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:<redacted>@')}`,
    ].join('\n');
  }

  if (code === 'ECONNREFUSED' || message.includes('ECONNREFUSED')) {
    return [
      'Database connection refused.',
      '',
      'Start Postgres first:',
      '  docker compose -f infra/docker-compose.yml up -d postgres redis',
      '  bun run db:migrate',
    ].join('\n');
  }

  return `Database preflight failed: ${message}`;
}

const sql = postgres(env.DATABASE_URL, { max: 1 });

try {
  await sql`select 1`;
  console.log('Database preflight ok');
} catch (error) {
  console.error(explain(error));
  process.exit(1);
} finally {
  await sql.end({ timeout: 1 }).catch(() => undefined);
}
