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

export default defineConfig(({ mode }) => {
  const frontendEnv = loadEnv(mode, process.cwd(), '');
  const rootEnv = loadRootDotEnv();

  const frontendOrigin = nonEmpty(frontendEnv.FRONTEND_ORIGIN) ?? nonEmpty(rootEnv.FRONTEND_ORIGIN);
  const frontendPort = Number(nonEmpty(frontendEnv.VITE_PORT) ?? nonEmpty(rootEnv.VITE_PORT) ?? (frontendOrigin ? new URL(frontendOrigin).port : '5173'));
  const apiBaseUrl = nonEmpty(frontendEnv.VITE_API_BASE_URL) ?? nonEmpty(rootEnv.VITE_API_BASE_URL) ?? '';

  return {
    envDir: resolve(__dirname, '..'),
    plugins: [react()],
    define: {
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify(apiBaseUrl),
    },
    server: { port: frontendPort },
  };
});
