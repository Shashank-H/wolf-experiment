# Dev Script Shutdown Fix

## Problem

`npm run dev` previously used:

```json
"dev": "bun run --filter '*' dev"
```

That starts workspace dev scripts, but signal handling was unreliable: pressing `Ctrl+C` could leave backend/frontend watcher processes running.

## Fix

Added `scripts/dev.mjs` and changed the root `dev` script to:

```json
"dev": "node scripts/dev.mjs"
```

The script:

- starts backend and frontend dev processes;
- forwards stdio unchanged;
- listens for `SIGINT`, `SIGTERM`, and `SIGHUP`;
- terminates each child process group on Unix so Bun/Vite watchers are cleaned up;
- force-kills remaining children after a short grace period;
- stops all processes if either backend or frontend exits unexpectedly.

## Validation

Use:

```bash
npm run dev
```

Then press `Ctrl+C`. Both backend and frontend should exit and ports `3000`/`5173` should be released.
