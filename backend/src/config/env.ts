import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Env = {
  NODE_ENV: 'development' | 'test' | 'production';
  APP_PORT: number;
  FRONTEND_ORIGIN: string;
  DATABASE_URL: string;
  REDIS_URL: string;
  APP_ENCRYPTION_KEY: string;
  SESSION_COOKIE_NAME: string;
  SESSION_TTL_DAYS: number;
  DRY_RUN_SCHEDULER_ENABLED: boolean;
  DRY_RUN_MORNING_TIME_IST: string;
  DRY_RUN_EOD_TIME_IST: string;
  GTT_REVALIDATION_SCHEDULER_ENABLED: boolean;
  GTT_REVALIDATION_INTERVAL_MINUTES: number;
};

const runtimeEnv: Record<string, string | undefined> =
  typeof Bun !== 'undefined' ? Bun.env : (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Existing shell values win over .env values.
    if (runtimeEnv[key] === undefined) runtimeEnv[key] = value;
  }
}

// Support one root .env whether commands are run from repo root or backend/.
loadEnvFile(resolve(process.cwd(), '.env'));
loadEnvFile(resolve(process.cwd(), '..', '.env'));

function read(name: string, fallback?: string): string {
  const value = runtimeEnv[name] ?? fallback;
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const raw = runtimeEnv[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function numberEnv(name: string, fallback: number): number {
  const raw = runtimeEnv[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric environment variable: ${name}`);
  return parsed;
}

const nodeEnv = (runtimeEnv.NODE_ENV as Env['NODE_ENV']) ?? 'development';
const developmentEncryptionKey = Buffer.from('dev-only-32-byte-key-change-me!!').toString('base64');

function isValidEncryptionKey(value: string): boolean {
  const bytes = Buffer.from(value, 'base64');
  return bytes.byteLength === 32 && bytes.toString('base64') === value;
}

function encryptionKey(): string {
  const value = read('APP_ENCRYPTION_KEY', nodeEnv === 'production' ? undefined : developmentEncryptionKey);
  if (isValidEncryptionKey(value)) return value;
  if (nodeEnv !== 'production') return developmentEncryptionKey;
  throw new Error('APP_ENCRYPTION_KEY must be base64-encoded 32 bytes. Generate with: openssl rand -base64 32');
}

export const env: Env = {
  NODE_ENV: nodeEnv,
  APP_PORT: numberEnv('APP_PORT', 3000),
  FRONTEND_ORIGIN: read('FRONTEND_ORIGIN', 'http://localhost:5173'),
  DATABASE_URL: read('DATABASE_URL', 'postgres://wolf:wolf@localhost:5432/wolf'),
  REDIS_URL: read('REDIS_URL', 'redis://localhost:6379'),
  APP_ENCRYPTION_KEY: encryptionKey(),
  SESSION_COOKIE_NAME: read('SESSION_COOKIE_NAME', 'wolf_session'),
  SESSION_TTL_DAYS: numberEnv('SESSION_TTL_DAYS', 30),
  DRY_RUN_SCHEDULER_ENABLED: booleanEnv('DRY_RUN_SCHEDULER_ENABLED', false),
  DRY_RUN_MORNING_TIME_IST: read('DRY_RUN_MORNING_TIME_IST', '08:45'),
  DRY_RUN_EOD_TIME_IST: read('DRY_RUN_EOD_TIME_IST', '15:35'),
  GTT_REVALIDATION_SCHEDULER_ENABLED: booleanEnv('GTT_REVALIDATION_SCHEDULER_ENABLED', false),
  GTT_REVALIDATION_INTERVAL_MINUTES: numberEnv('GTT_REVALIDATION_INTERVAL_MINUTES', 60),
};

if (!['development', 'test', 'production'].includes(env.NODE_ENV)) {
  throw new Error(`Invalid NODE_ENV: ${env.NODE_ENV}`);
}

if (!isValidEncryptionKey(env.APP_ENCRYPTION_KEY)) {
  throw new Error('APP_ENCRYPTION_KEY must be base64-encoded 32 bytes. Generate with: openssl rand -base64 32');
}

if (env.GTT_REVALIDATION_INTERVAL_MINUTES < 1) {
  throw new Error('GTT_REVALIDATION_INTERVAL_MINUTES must be at least 1');
}
