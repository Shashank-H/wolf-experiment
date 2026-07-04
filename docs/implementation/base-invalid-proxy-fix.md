# `base.invalid` Vite Proxy Fix

## Problem

Vite logged errors like:

```txt
[vite] http proxy error: /auth/me
Error: getaddrinfo ENOTFOUND base.invalid
```

That means the dev proxy target resolved to `http://base.invalid`, which is a placeholder host and not the backend.

## Fix

`frontend/vite.config.ts` now sanitizes proxy target inputs:

- ignores blank `VITE_API_PROXY_TARGET` values;
- ignores invalid URLs;
- ignores `base.invalid` placeholder URLs;
- falls back to `http://localhost:${APP_PORT}`;
- logs the resolved proxy target at startup.

With the current root `.env`, Vite logs:

```txt
[vite] proxying API routes to http://localhost:3040
```

## Validation

Validated that even when the shell provides:

```bash
VITE_API_PROXY_TARGET=http://base.invalid
```

Vite falls back to:

```txt
http://localhost:3040
```

and typechecking passes.

## What to do locally

Restart dev so Vite reloads config:

```bash
Ctrl+C
npm run dev
```

Confirm startup output includes:

```txt
[vite] proxying API routes to http://localhost:3040
```
