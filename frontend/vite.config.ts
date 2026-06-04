import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

function loadRootDotEnv(): Record<string, string> {
  const envPath = resolve(__dirname, '..', '.env');
  if (!existsSync(envPath)) return {};

  const values: Record<string, string> = {};
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function safeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    // `base.invalid` is a placeholder used by some tooling; never proxy to it.
    if (url.hostname === 'base.invalid') return undefined;
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

export default defineConfig(({ mode }) => {
  const frontendEnv = loadEnv(mode, process.cwd(), '');
  const rootEnv = loadRootDotEnv();

  const appPort = nonEmpty(frontendEnv.APP_PORT) ?? nonEmpty(rootEnv.APP_PORT) ?? '3000';
  const backendTarget =
    safeUrl(nonEmpty(frontendEnv.VITE_API_PROXY_TARGET)) ??
    safeUrl(nonEmpty(rootEnv.VITE_API_PROXY_TARGET)) ??
    `http://localhost:${appPort}`;

  const frontendOrigin = nonEmpty(frontendEnv.FRONTEND_ORIGIN) ?? nonEmpty(rootEnv.FRONTEND_ORIGIN);
  const frontendPort = Number(nonEmpty(frontendEnv.VITE_PORT) ?? nonEmpty(rootEnv.VITE_PORT) ?? (frontendOrigin ? new URL(frontendOrigin).port : '5173'));

  console.log(`[vite] proxying API routes to ${backendTarget}`);

  return {
    plugins: [react()],
    server: {
      port: frontendPort,
      proxy: {
        '/auth': { target: backendTarget, changeOrigin: true },
        '/settings': { target: backendTarget, changeOrigin: true },
        '/portfolio': { target: backendTarget, changeOrigin: true },
        '/orders': { target: backendTarget, changeOrigin: true },
        '/health': { target: backendTarget, changeOrigin: true },
        '/ready': { target: backendTarget, changeOrigin: true },
      },
    },
  };
});
