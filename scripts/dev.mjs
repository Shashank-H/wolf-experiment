#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const children = new Set();
let shuttingDown = false;

function loadRootEnv() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
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

    // Shell/env values win over .env values.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadRootEnv();

const commands = [
  { name: 'backend', command: 'bun', args: ['--cwd', 'backend', 'dev'] },
  { name: 'frontend', command: 'bun', args: ['--cwd', 'frontend', 'dev'] },
];

function start({ name, command, args }) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    detached: process.platform !== 'win32',
    env: process.env,
  });

  child.name = name;
  children.add(child);

  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!shuttingDown) {
      console.error(`[dev] ${name} exited with ${signal ?? code}; stopping remaining processes`);
      shutdown(code ?? 1);
    }
  });

  return child;
}

function killChild(child) {
  if (child.killed) return;

  try {
    if (process.platform !== 'win32' && child.pid) {
      process.kill(-child.pid, 'SIGTERM');
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    // Process may have already exited.
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) killChild(child);

  const forceTimer = setTimeout(() => {
    for (const child of children) {
      try {
        if (process.platform !== 'win32' && child.pid) {
          process.kill(-child.pid, 'SIGKILL');
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        // Process may have already exited.
      }
    }
    process.exit(exitCode);
  }, 2000);

  forceTimer.unref();

  const waitTimer = setInterval(() => {
    if (children.size === 0) {
      clearInterval(waitTimer);
      process.exit(exitCode);
    }
  }, 50);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('SIGHUP', () => shutdown(0));

for (const command of commands) start(command);
