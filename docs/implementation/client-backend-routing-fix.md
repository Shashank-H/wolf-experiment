# Client Backend Routing Fix

## Problem

The frontend was not reliably reaching the backend because the client/dev-server routing was hardcoded:

- Vite always listened on `5173`.
- Vite proxied API requests to `http://localhost:3000`.
- The local `.env` uses `APP_PORT=3040` and `FRONTEND_ORIGIN=http://localhost:6173`.

So the browser/dev server and backend could be running on different ports than the client proxy expected.

## Fix

### Vite dev proxy

`frontend/vite.config.ts` now loads the root `.env` and derives:

- frontend port from `VITE_PORT`, or from `FRONTEND_ORIGIN`, or default `5173`;
- backend proxy target from `VITE_API_PROXY_TARGET`, or `APP_PORT`, or default `3000`.

This means relative browser calls such as `/auth/login` and `/settings/trading` are proxied to the correct backend during `npm run dev`.

### Client API base URL

`frontend/src/main.tsx` now supports:

```txt
VITE_API_BASE_URL=http://localhost:3040
```

When set, the browser calls the backend directly. When blank, Vite dev proxy handles relative API calls.

### Backend CORS

`backend/src/index.ts` now accepts comma-separated `FRONTEND_ORIGIN` values, which helps when using multiple local frontend origins.

## Recommended local `.env`

```txt
APP_PORT=3040
FRONTEND_ORIGIN=http://localhost:6173
VITE_PORT=6173
VITE_API_BASE_URL=
VITE_API_PROXY_TARGET=
```

For Vite dev, keep `VITE_API_BASE_URL` blank so calls go through the dev proxy.

For a built/static frontend, set `VITE_API_BASE_URL` to the backend origin.

## Validation

Validated with:

```bash
npm run dev
curl http://localhost:6173/health
```

The response was:

```json
{"status":"ok"}
```

That proves the client dev server is now proxying to the backend correctly.
